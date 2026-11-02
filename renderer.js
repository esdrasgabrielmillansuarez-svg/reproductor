const fileInput = document.getElementById('fileInput');
const playlistEl = document.getElementById('playlist');
const audio = document.getElementById('audio');
const playPauseBtn = document.getElementById('playPause');
const stopBtn = document.getElementById('stop');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const volume = document.getElementById('volume');
const seek = document.getElementById('seek');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const fileName = document.getElementById('fileName');
const dropHint = document.querySelector('.drop-hint');
const openFolderBtn = document.getElementById('openFolder');
const coverArt = document.getElementById('coverArt');
const coverContainer = document.querySelector('.cover');
const suggestionsEl = document.getElementById('suggestions');
const autoplayBtn = document.getElementById('autoplaySuggest');
const saveBtn = document.getElementById('savePlaylist');
const loadBtn = document.getElementById('loadPlaylist');

let playlist = []; // { name, url, realPath?, artist?, title?, genre?, cover? }
let currentIndex = -1;
let isSeeking = false;
let autoplaySuggestions = false;

function formatTime(s) {
  if (!isFinite(s) || s <= 0) return '00:00';
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function renderPlaylist() {
  playlistEl.innerHTML = '';
  playlist.forEach((item, idx) => {
    const li = document.createElement('li');
    const title = item.title || item.name;
    li.textContent = title;
    if (idx === currentIndex) li.classList.add('active');
    li.addEventListener('dblclick', () => playIndex(idx));
    li.addEventListener('click', () => { currentIndex = idx; updateUI(); });
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✖';
    removeBtn.title = 'Eliminar';
    removeBtn.style.marginLeft = '8px';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // revoke object URL if present
      if (playlist[idx] && playlist[idx].url && playlist[idx].url.startsWith('blob:')) {
        URL.revokeObjectURL(playlist[idx].url);
      }
      playlist.splice(idx,1);
      if (currentIndex===idx) stop();
      if (currentIndex>idx) currentIndex--;
      renderPlaylist();
      updateUI();
    });
    li.appendChild(removeBtn);
    playlistEl.appendChild(li);
  });
}

async function readTagsFromFile(file, item) {
  // jsmediatags exposed via CDN as window.jsmediatags
  if (window.jsmediatags && file) {
    try {
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags || {};
          item.artist = tags.artist || item.artist || '';
          item.title = tags.title || item.title || item.name;
          item.genre = tags.genre || item.genre || '';

          // extract picture
          if (tags.picture) {
            const picture = tags.picture;
            const byteArray = new Uint8Array(picture.data);
            const blob = new Blob([byteArray], { type: picture.format || 'image/jpeg' });
            const imageUrl = URL.createObjectURL(blob);
            item.cover = imageUrl;
            // if updating current track, update UI
            if (playlist[currentIndex] === item) updateCover();
            renderPlaylist();
          }
        },
        onError: (error) => {
          // ignore metadata errors
          console.warn('Metadata read error', error);
        }
      });
    } catch (e) {
      console.warn('jsmediatags failed', e);
    }
  }
}

function addFiles(files) {
  for (const f of files) {
    const realPath = f.path || null;
    const url = realPath ? `file://${realPath}` : URL.createObjectURL(f);
    const item = { name: f.name, url, realPath };
    playlist.push(item);
    // attempt to read tags (async)
    readTagsFromFile(f, item);
    // assign a random anime cover (override any embedded cover)
    assignAnimeCover(item);
  }
  if (currentIndex === -1 && playlist.length) currentIndex = 0;
  renderPlaylist();
  updateUI();
}

// In-memory cache and concurrency limiter for anime covers
const animeCoverCache = new Map(); // key -> image URL
let animeFetchQueue = []; // tasks: { item, resolve }
let animeFetching = 0;
const MAX_ANIME_FETCH = 4; // limit concurrent requests

function queueAnimeCoverFetch(item) {
  return new Promise((resolve) => {
    animeFetchQueue.push({ item, resolve });
    processAnimeQueue();
  });
}

async function processAnimeQueue() {
  if (animeFetching >= MAX_ANIME_FETCH) return;
  const task = animeFetchQueue.shift();
  if (!task) return;
  animeFetching++;
  const item = task.item;
  const key = (item.title || item.name || 'default').toString();
  try {
    let url = animeCoverCache.get(key);
    if (!url) {
      // fetch from waifu.pics
      const res = await fetch('https://api.waifu.pics/sfw/waifu');
      if (res.ok) {
        const json = await res.json();
        url = json && json.url ? json.url : null;
        if (url) animeCoverCache.set(key, url);
      } else {
        url = null;
      }
    }

    if (url) {
      item.cover = url;
      item.animeCover = url;
      if (playlist[currentIndex] === item) updateCover();
      renderPlaylist();
    }

    task.resolve(url);
  } catch (e) {
    console.warn('Failed to fetch anime cover', e);
    task.resolve(null);
  } finally {
    animeFetching--;
    // process next in queue
    setTimeout(processAnimeQueue, 0);
  }
}

let saveCacheTimer = null;
function scheduleSaveCache() {
  if (saveCacheTimer) clearTimeout(saveCacheTimer);
  saveCacheTimer = setTimeout(async () => {
    try {
      const obj = Object.fromEntries(animeCoverCache);
      await window.electronAPI.saveCache(obj);
    } catch (e) {
      console.warn('Failed to save cache', e);
    }
  }, 800);
}

async function assignAnimeCover(item) {
  if (!item) return null;
  const key = (item.title || item.name || 'default').toString();
  if (animeCoverCache.has(key)) {
    const cached = animeCoverCache.get(key);
    item.cover = cached;
    item.animeCover = cached;
    if (playlist[currentIndex] === item) updateCover();
    renderPlaylist();
    return cached;
  }
  // queue the fetch so concurrency is limited
  const url = await queueAnimeCoverFetch(item);
  if (url) {
    // ensure cache persisted
    scheduleSaveCache();
  }
  return url;
}

fileInput.addEventListener('change', (e) => {
  if (!e.target.files) return;
  addFiles(Array.from(e.target.files));
});

openFolderBtn.addEventListener('click', () => fileInput.click());

function playIndex(index) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  audio.src = playlist[currentIndex].url;
  audio.play();
  updateUI();
}

let webSuggestEnabled = false; // toggled by user

function computeSuggestions() {
  const suggestions = [];
  if (currentIndex < 0 || !playlist[currentIndex]) return suggestions;
  const current = playlist[currentIndex];
  // prefer same artist
  if (current.artist) {
    for (let i = 0; i < playlist.length && suggestions.length < 4; i++) {
      if (i === currentIndex) continue;
      if (playlist[i].artist && playlist[i].artist === current.artist) suggestions.push({ type: 'local', idx: i, item: playlist[i] });
    }
  }
  // then same genre
  if (current.genre && suggestions.length < 4) {
    for (let i = 0; i < playlist.length && suggestions.length < 4; i++) {
      if (i === currentIndex) continue;
      if (playlist[i].genre && playlist[i].genre === current.genre && !suggestions.find(s => s.idx===i)) suggestions.push({ type: 'local', idx: i, item: playlist[i] });
    }
  }
  // fill with random other tracks
  for (let i = 0; i < playlist.length && suggestions.length < 4; i++) {
    if (i === currentIndex) continue;
    if (!suggestions.find(s => s.idx===i)) suggestions.push({ type: 'local', idx: i, item: playlist[i] });
  }
  return suggestions;
}

async function fetchWebSuggestions(query, limit = 6) {
  // Try iTunes Search API first (no key required)
  try {
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&entity=song&limit=' + limit;
    const res = await fetch(url);
    if (!res.ok) throw new Error('iTunes failed');
    const data = await res.json();
    if (data && data.results && data.results.length) {
      return data.results.map(r => ({ type: 'remote', title: r.trackName, artist: r.artistName, preview: r.previewUrl || null, artwork: r.artworkUrl100 || null }));
    }
  } catch (e) {
    console.warn('iTunes suggestion error', e);
  }
  // fallback: Deezer search
  try {
    const url = 'https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=' + limit + '&output=jsonp';
    // Deezer JSONP isn't directly usable via fetch; skip fallback in that case
    return [];
  } catch (e) {
    return [];
  }
}

// Fetch YouTube search results by scraping HTML and using oEmbed for details
async function fetchYouTubeSuggestions(query, limit = 6) {
  try {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('YouTube search failed');
    const text = await res.text();
    const ids = new Set();
    const regex = /"videoId":"([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) && ids.size < limit) ids.add(m[1]);
    const results = [];
    for (const id of Array.from(ids).slice(0, limit)) {
      try {
        const oembedUrl = 'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + id + '&format=json';
        const o = await fetch(oembedUrl);
        if (!o.ok) continue;
        const j = await o.json();
        results.push({ id, title: j.title, artist: j.author_name, thumbnail: j.thumbnail_url, url: 'https://www.youtube.com/watch?v=' + id });
      } catch (e) {
        continue;
      }
    }
    return results;
  } catch (e) {
    console.warn('YouTube suggestion error', e);
    return [];
  }
}

async function renderSuggestions() {
  suggestionsEl.innerHTML = '';
  const local = computeSuggestions();
  // show local suggestions first
  local.forEach(s => {
    const li = document.createElement('li');
    const container = document.createElement('div');
    container.className = 'suggestion-item';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'suggestion-thumb';

    const thumbImg = document.createElement('img');
    const hasImage = Boolean(s.item.cover || s.item.animeCover);
    if (hasImage) {
      thumbImg.src = s.item.cover || s.item.animeCover;
      thumbWrap.appendChild(thumbImg);
    } else {
      // show spinner while waiting for cover
      const spinner = document.createElement('div');
      spinner.className = 'thumb-spinner';
      thumbWrap.appendChild(spinner);
      // ensure an assign has been queued for this item
      assignAnimeCover(s.item).then((url) => {
        if (url) {
          thumbImg.src = url;
          thumbWrap.innerHTML = '';
          thumbWrap.appendChild(thumbImg);
        }
      });
    }

    const meta = document.createElement('div');
    meta.className = 'suggestion-meta';
    const title = document.createElement('div'); title.className = 'suggestion-title'; title.textContent = s.item.title || s.item.name;
    const sub = document.createElement('div'); sub.className = 'suggestion-sub'; sub.textContent = s.item.artist || '';
    meta.appendChild(title); meta.appendChild(sub);
    container.appendChild(thumbWrap); container.appendChild(meta);
    li.appendChild(container);

    const playBtn = document.createElement('button');
    playBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><use href="#icon-play"/></svg>';
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); playIndex(s.idx); });
    // pressed visual feedback
    playBtn.addEventListener('mousedown', () => playBtn.classList.add('pressed'));
    playBtn.addEventListener('mouseup', () => playBtn.classList.remove('pressed'));
    playBtn.addEventListener('mouseleave', () => playBtn.classList.remove('pressed'));

    li.addEventListener('click', () => playIndex(s.idx));
    li.appendChild(playBtn);
    suggestionsEl.appendChild(li);
  });

  // If web suggestions enabled, fetch and show them under local suggestions
  if (webSuggestEnabled) {
    const current = playlist[currentIndex];
    const q = [current.title, current.artist, current.name].filter(Boolean).join(' ');
    if (q) {
      const web = await fetchWebSuggestions(q, 6);
      web.forEach(w => {
        const li = document.createElement('li');
        const container = document.createElement('div');
        container.className = 'suggestion-item';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'suggestion-thumb';
        const thumbImg = document.createElement('img');
        if (w.artwork) {
          thumbImg.src = w.artwork;
          thumbWrap.appendChild(thumbImg);
        } else {
          const spinner = document.createElement('div');
          spinner.className = 'thumb-spinner';
          thumbWrap.appendChild(spinner);
        }

        const meta = document.createElement('div');
        meta.className = 'suggestion-meta';
        const title = document.createElement('div'); title.className = 'suggestion-title'; title.textContent = w.title || 'Unknown';
        const sub = document.createElement('div'); sub.className = 'suggestion-sub'; sub.textContent = w.artist || '';
        meta.appendChild(title); meta.appendChild(sub);
        container.appendChild(thumbWrap); container.appendChild(meta);
        li.appendChild(container);

        const playBtn = document.createElement('button');
        playBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><use href="#icon-play"/></svg>';
        playBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // when user plays a web suggestion, add it to playlist (use preview if available)
          const newItem = { name: `${w.title} - ${w.artist}`, url: w.preview || w.artwork || null, realPath: null, title: w.title, artist: w.artist };
          // assign anime cover (random) and prefer it
          await assignAnimeCover(newItem);
          playlist.push(newItem);
          currentIndex = playlist.length - 1;
          renderPlaylist();
          playIndex(currentIndex);
        });
        playBtn.addEventListener('mousedown', () => playBtn.classList.add('pressed'));
        playBtn.addEventListener('mouseup', () => playBtn.classList.remove('pressed'));
        playBtn.addEventListener('mouseleave', () => playBtn.classList.remove('pressed'));

        const openBtn = document.createElement('button');
        openBtn.textContent = 'Abrir';
        openBtn.addEventListener('click', (e) => { e.stopPropagation(); window.electronAPI.openExternal(w.url); });
        openBtn.addEventListener('mousedown', () => openBtn.classList.add('pressed'));
        openBtn.addEventListener('mouseup', () => openBtn.classList.remove('pressed'));
        openBtn.addEventListener('mouseleave', () => openBtn.classList.remove('pressed'));

        li.addEventListener('click', async () => {
          if (w.preview) {
            const newItem = { name: `${w.title} - ${w.artist}`, url: w.preview, realPath: null, title: w.title, artist: w.artist };
            await assignAnimeCover(newItem);
            playlist.push(newItem);
            currentIndex = playlist.length - 1;
            renderPlaylist();
            playIndex(currentIndex);
          }
        });

        li.appendChild(openBtn);
        li.appendChild(playBtn);
        suggestionsEl.appendChild(li);
      });
    }
  }

  if (youtubeSuggestEnabled) {
    const current = playlist[currentIndex];
    const q = [current.title, current.artist, current.name].filter(Boolean).join(' ');
    if (q) {
      const vids = await fetchYouTubeSuggestions(q, 6);
      vids.forEach(v => {
        const li = document.createElement('li');
        const container = document.createElement('div');
        container.className = 'suggestion-item';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'suggestion-thumb';
        const thumbImg = document.createElement('img');
        if (v.thumbnail) {
          thumbImg.src = v.thumbnail;
          thumbWrap.appendChild(thumbImg);
        } else {
          const spinner = document.createElement('div');
          spinner.className = 'thumb-spinner';
          thumbWrap.appendChild(spinner);
        }

        const meta = document.createElement('div');
        meta.className = 'suggestion-meta';
        const title = document.createElement('div'); title.className = 'suggestion-title'; title.textContent = v.title || 'Unknown';
        const sub = document.createElement('div'); sub.className = 'suggestion-sub'; sub.textContent = v.artist || '';
        meta.appendChild(title); meta.appendChild(sub);
        container.appendChild(thumbWrap); container.appendChild(meta);
        li.appendChild(container);

        const openBtn = document.createElement('button');
        openBtn.textContent = 'Abrir';
        openBtn.addEventListener('click', (e) => { e.stopPropagation(); window.electronAPI.openExternal(v.url); });
        openBtn.addEventListener('mousedown', () => openBtn.classList.add('pressed'));
        openBtn.addEventListener('mouseup', () => openBtn.classList.remove('pressed'));
        openBtn.addEventListener('mouseleave', () => openBtn.classList.remove('pressed'));

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Agregar';
        addBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newItem = { name: `${v.title} - ${v.artist}`, url: v.url, realPath: null, title: v.title, artist: v.artist };
          // set thumbnail as cover if available
          if (v.thumbnail) { newItem.cover = v.thumbnail; }
          await assignAnimeCover(newItem); // also assign anime cover
          playlist.push(newItem);
          currentIndex = playlist.length - 1;
          renderPlaylist();
        });
        addBtn.addEventListener('mousedown', () => addBtn.classList.add('pressed'));
        addBtn.addEventListener('mouseup', () => addBtn.classList.remove('pressed'));
        addBtn.addEventListener('mouseleave', () => addBtn.classList.remove('pressed'));

        li.addEventListener('click', () => window.electronAPI.openExternal(v.url));

        li.appendChild(openBtn);
        li.appendChild(addBtn);
        suggestionsEl.appendChild(li);
      });
    }
  }
}


function playNextSuggestion() {
  const sugs = computeSuggestions();
  if (sugs.length) playIndex(sugs[0].idx);
  else playNext();
}

function playNext() {
  if (playlist.length === 0) return;
  currentIndex = (currentIndex + 1) % playlist.length;
  playIndex(currentIndex);
}

function playPrev() {
  if (playlist.length === 0) return;
  currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
  playIndex(currentIndex);
}

function stop() {
  audio.pause();
  audio.currentTime = 0;
  playPauseBtn.textContent = '▶️';
}

// Play/Pause behaviour with visual state
playPauseBtn.addEventListener('click', () => {
  if (!audio.src && playlist.length) playIndex(currentIndex || 0);
  else if (audio.paused) audio.play(); else audio.pause();
});

// visual feedback on button press
[...document.querySelectorAll('.left-controls button, .header-actions button, .suggestions li button')].forEach(btn => {
  btn.addEventListener('mousedown', () => btn.classList.add('pressed'));
  btn.addEventListener('mouseup', () => btn.classList.remove('pressed'));
  btn.addEventListener('mouseleave', () => btn.classList.remove('pressed'));
});

prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', () => { if (autoplaySuggestions) playNextSuggestion(); else playNext(); });
stopBtn.addEventListener('click', stop);

autoplayBtn.addEventListener('click', () => { autoplaySuggestions = !autoplaySuggestions; autoplayBtn.textContent = autoplaySuggestions ? 'Autoplay ON' : 'Autoplay sugerencias'; autoplayBtn.classList.toggle('active', autoplaySuggestions); });

const webSuggestToggle = document.getElementById('webSuggestToggle');
webSuggestToggle.addEventListener('click', () => {
  webSuggestEnabled = !webSuggestEnabled;
  webSuggestToggle.textContent = webSuggestEnabled ? 'Web ON' : 'Buscar web';
  webSuggestToggle.classList.toggle('active', webSuggestEnabled);
  renderSuggestions();
});

let youtubeSuggestEnabled = false;
const youtubeSuggestToggle = document.getElementById('youtubeSuggestToggle');
youtubeSuggestToggle.addEventListener('click', () => {
  youtubeSuggestEnabled = !youtubeSuggestEnabled;
  youtubeSuggestToggle.textContent = youtubeSuggestEnabled ? 'YouTube ON' : 'YouTube';
  youtubeSuggestToggle.classList.toggle('active', youtubeSuggestEnabled);
  renderSuggestions();
});

volume.addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });

audio.addEventListener('loadedmetadata', () => {
  seek.max = Math.floor(audio.duration) || 0;
  durationEl.textContent = formatTime(audio.duration);
  currentTimeEl.textContent = formatTime(audio.currentTime);
  fileName.textContent = playlist[currentIndex] ? (playlist[currentIndex].title || playlist[currentIndex].name) : '';
});

audio.addEventListener('timeupdate', () => {
  if (!isSeeking) seek.value = Math.floor(audio.currentTime);
  currentTimeEl.textContent = formatTime(audio.currentTime);
});

audio.addEventListener('play', () => { playPauseBtn.textContent = '⏸'; playPauseBtn.classList.add('playing'); renderPlaylist(); renderSuggestions(); updateCover(); });
audio.addEventListener('pause', () => { playPauseBtn.textContent = '▶️'; playPauseBtn.classList.remove('playing'); });
audio.addEventListener('ended', () => { playPauseBtn.classList.remove('playing'); if (autoplaySuggestions) playNextSuggestion(); else playNext(); });

seek.addEventListener('input', () => { isSeeking = true; currentTimeEl.textContent = formatTime(parseFloat(seek.value)); });
seek.addEventListener('change', () => { audio.currentTime = parseFloat(seek.value); isSeeking = false; });

// keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!audio.src && playlist.length) playIndex(currentIndex || 0);
    else if (audio.paused) audio.play(); else audio.pause();
  }
  if (e.code === 'ArrowRight') audio.currentTime += 5;
  if (e.code === 'ArrowLeft') audio.currentTime -= 5;
});

// Drag and drop support
['dragenter','dragover'].forEach(ev => {
  window.addEventListener(ev, (e) => { e.preventDefault(); dropHint.style.opacity = '1'; });
});
['dragleave','drop'].forEach(ev => {
  window.addEventListener(ev, (e) => { e.preventDefault(); dropHint.style.opacity = '0.6'; });
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio'));
  if (files.length) addFiles(files);
});

function updateCover() {
  const item = playlist[currentIndex];
  if (item && item.cover) {
    // set image and crossfade
    coverArt.src = item.cover;
    coverContainer.classList.add('has-cover');
  } else {
    // remove image and show placeholder
    coverArt.src = '';
    coverContainer.classList.remove('has-cover');
  }
}

function updateUI(){
  // update now playing and playlist highlight
  fileName.textContent = (playlist[currentIndex] && (playlist[currentIndex].title || playlist[currentIndex].name)) || 'Ninguna pista seleccionada';
  const items = playlistEl.querySelectorAll('li');
  items.forEach((it, i) => it.classList.toggle('active', i === currentIndex));
  renderSuggestions();
  updateCover();
}

// Save / Load playlist (persists file paths when possible)
saveBtn.addEventListener('click', async () => {
  // include cover/animeCover fields so playlist persists thumbnails
  const toSave = playlist.map(it => ({
    name: it.name,
    realPath: it.realPath || null,
    title: it.title || null,
    artist: it.artist || null,
    genre: it.genre || null,
    cover: it.cover || null,
    animeCover: it.animeCover || null
  }));
  try {
    const res = await window.electronAPI.savePlaylist(toSave);
    if (res && res.ok) alert('Playlist guardada en: ' + res.path);
    else alert('Error guardando playlist: ' + (res && res.error));
  } catch (e) { alert('Error: ' + e.message); }
});

loadBtn.addEventListener('click', async () => {
  try {
    const res = await window.electronAPI.loadPlaylist();
    if (res && res.ok && Array.isArray(res.playlist)) {
      // reconstruct playlist using file:// paths where possible
      playlist = res.playlist.map(it => ({ name: it.name, url: it.realPath ? `file://${it.realPath}` : (it.url || it.cover || null), realPath: it.realPath || null, title: it.title || null, artist: it.artist || null, genre: it.genre || null, cover: it.cover || it.animeCover || null }));
      // filter out entries without accessible path
      playlist = playlist.filter(it => it.url !== null);
      currentIndex = playlist.length ? 0 : -1;
      renderPlaylist();
      // assign anime covers for loaded items
      for (const it of playlist) {
        assignAnimeCover(it);
      }
      updateUI();
      alert('Playlist cargada, ' + playlist.length + ' pistas');
    } else {
      alert('No hay playlist guardada');
    }
  } catch (e) { alert('Error cargando playlist: ' + e.message); }
});

// load persisted cache (if any) then initialize UI
(async function initialize() {
  try {
    const res = await window.electronAPI.loadCache();
    if (res && res.ok && res.cache) {
      const obj = res.cache;
      for (const k of Object.keys(obj)) {
        animeCoverCache.set(k, obj[k]);
      }
      // apply cached covers to existing playlist entries
      playlist.forEach(it => {
        const key = (it.title || it.name || 'default').toString();
        if (animeCoverCache.has(key)) {
          it.cover = animeCoverCache.get(key);
          it.animeCover = it.cover;
        }
      });
    }
  } catch (e) {
    // ignore load cache errors
    console.warn('loadCache error', e);
  }

  updateUI();
  renderPlaylist();
})();
