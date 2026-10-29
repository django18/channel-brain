/**
 * Channel Knowledge: pick a channel, ask it questions, get answers that cite
 * timestamped transcript excerpts. Plain JS, no build step.
 */
(function () {
  'use strict';

  var STORAGE = { clientId: 'ct.clientId', apiKey: 'ct.apiKey', channel: 'ct.channel' };
  var HISTORY_TURNS_SENT = 6;
  var THINKING_STEPS = ['Understanding your question', 'Searching {chunks} transcript passages', 'Reading the best matches', 'Writing a cited answer'];

  var esc = window.Markdown.escapeHtml;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var el = {
    channelList: document.getElementById('channelList'),
    recentList: document.getElementById('recentList'),
    clearRecent: document.getElementById('clearRecent'),
    log: document.getElementById('log'),
    form: document.getElementById('promptForm'),
    input: document.getElementById('promptInput'),
    sub: document.getElementById('chatSub'),
    enter: document.getElementById('enterBtn'),
    path: document.getElementById('termPath'),
    status: document.getElementById('termStatus'),
    topMeta: document.getElementById('topbarMeta'),
  };

  var state = {
    channels: [],
    current: null,
    conversations: {}, // channelId -> [{ role, content, sources, meta }]
    recent: [],
    suggestions: [],
    busy: false,
    booting: false,
    recall: { items: [], index: -1 },
    msgSeq: 0,
  };

  // ---------- storage (every access may throw in private mode) ----------

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* history and key just won't persist */ }
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function clientId() {
    var id = load(STORAGE.clientId);
    if (!id && window.crypto && crypto.randomUUID) {
      id = crypto.randomUUID();
      store(STORAGE.clientId, id);
    }
    return id;
  }

  // ---------- api ----------

  function api(path, options) {
    options = options || {};
    var headers = { 'content-type': 'application/json' };
    var id = clientId();
    var key = load(STORAGE.apiKey);
    if (id) headers['x-client-id'] = id;
    if (key) headers['x-api-key'] = key;
    return fetch(path, { method: options.method || 'GET', headers: headers, body: options.body ? JSON.stringify(options.body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (res.status === 401) throw apiError('This server needs an API key. Type /key <your-key>.', 401);
          if (res.status === 429) throw apiError('Too many questions in a short time. Wait a minute and try again.', 429);
          if (!res.ok || json.success === false) throw apiError(json.error || ('Request failed (' + res.status + ')'), res.status);
          return json.data;
        });
      });
  }

  function apiError(message, status) {
    var error = new Error(message);
    error.status = status;
    return error;
  }

  // ---------- status ----------

  function setStatus(text, kind) {
    el.status.className = 'status' + (kind ? ' ' + kind : '');
    el.status.textContent = text;
  }

  function setBusy(busy) {
    state.busy = busy;
    el.enter.disabled = busy;
    setStatus(busy ? 'Thinking…' : '', busy ? 'busy' : '');
  }

  // ---------- channels ----------

  function formatCount(n) {
    if (n == null) return '?';
    return n >= 10000 ? Math.round(n / 1000) + 'k' : n.toLocaleString();
  }

  function initials(name) {
    var words = String(name).trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  function renderChannels() {
    el.channelList.innerHTML = state.channels.map(function (c) {
      var selected = state.current && state.current.id === c.id;
      return '<button type="button" class="channel" role="option" data-id="' + esc(c.id) + '" aria-selected="' + selected + '">' +
        '<span class="channel-avatar" aria-hidden="true">' + esc(initials(c.name)) + '</span>' +
        '<span class="channel-name">' + esc(c.name) + '</span>' +
        '<span class="channel-sub">' + esc(c.topic) + ' · ' + formatCount(c.videos) + ' videos</span>' +
        '</button>';
    }).join('');
  }

  function selectChannel(id) {
    var channel = state.channels.find(function (c) { return c.id === id; });
    if (!channel) return false;
    state.current = channel;
    state.conversations[id] = state.conversations[id] || [];
    store(STORAGE.channel, id);
    try { history.replaceState(null, '', '?channel=' + encodeURIComponent(id)); } catch (e) { /* file:// or sandboxed */ }

    el.path.textContent = channel.name;
    el.sub.innerHTML = '<a href="' + esc(channel.channelUrl) + '" target="_blank" rel="noopener">' + esc(channel.handle) + '</a> · ' + esc(channel.topic);
    el.input.placeholder = 'Ask ' + channel.name + ' a question…';
    document.title = channel.name + ' · Channel Knowledge';
    renderChannels();
    renderLog();
    loadSuggestions();
    loadRecent();
    el.input.focus();
    return true;
  }

  // ---------- suggestions & recent ----------

  function loadSuggestions() {
    var id = state.current.id;
    api('/api/channels/' + encodeURIComponent(id) + '/suggestions')
      .then(function (list) {
        if (state.current.id !== id) return;
        state.suggestions = list;
        renderSuggestions();
      })
      .catch(function (error) { console.warn('suggestions failed', error); });
  }

  function renderSuggestions() {
    var box = document.getElementById('suggestions');
    if (!box) return;
    box.innerHTML = state.suggestions.map(function (q) {
      return '<button type="button" class="suggestion" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('') || '<span class="muted small">No suggestions yet</span>';
  }

  function loadRecent() {
    var id = state.current.id;
    api('/api/channels/' + encodeURIComponent(id) + '/recent')
      .then(function (list) {
        if (state.current.id !== id) return;
        state.recent = list;
        state.recall = { items: list.map(function (r) { return r.question; }), index: -1 };
        renderRecent();
      })
      .catch(function (error) { console.warn('recent failed', error); });
  }

  function timeAgo(iso) {
    var seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    return Math.floor(seconds / 86400) + 'd';
  }

  function renderRecent() {
    el.recentList.innerHTML = state.recent.length
      ? state.recent.map(function (r) {
          return '<li><button type="button" data-q="' + esc(r.question) + '" title="' + esc(r.question) + ' (' + esc(timeAgo(r.askedAt)) + ' ago)">' + esc(r.question) + '</button></li>';
        }).join('')
      : '<li class="muted small">No searches yet</li>';
  }

  // ---------- log rendering ----------

  function renderWelcome() {
    var c = state.current;
    return '<section class="welcome">' +
      '<h1>' + esc(c.name) + '</h1>' +
      '<p>' + esc(c.description) + '.</p>' +
      '<p class="stats-line">' + formatCount(c.videos) + ' videos · ' + formatCount(c.chunks) + ' searchable passages</p>' +
      '<div class="suggest-head"><span class="label">Suggested questions</span><button type="button" class="link-btn" data-action="reshuffle">Show others</button></div>' +
      '<div class="suggestions" id="suggestions"><span class="muted small">Loading…</span></div>' +
      '</section>';
  }

  function renderLog() {
    var messages = state.conversations[state.current.id];
    el.log.innerHTML = renderWelcome() + messages.map(renderMessage).join('');
    renderSuggestions();
    scrollToEnd();
  }

  function renderMessage(m) {
    if (m.role === 'user') {
      return '<div class="msg msg-user"><div class="text">' + esc(m.content) + '</div></div>';
    }
    if (m.role === 'system') {
      return '<div class="msg sys' + (m.error ? ' err' : '') + '"><pre>' + esc(m.content) + '</pre></div>';
    }
    var prefix = 'src-' + m.id + '-';
    var body = m.content
      ? '<div class="answer">' + window.Markdown.render(m.content, prefix) + '</div>'
      : '<div class="answer"><p class="muted">Couldn\'t write an answer right now, so here are the most relevant excerpts:</p>' +
        (m.sources || []).slice(0, 4).map(function (s) { return '<blockquote>' + esc(s.excerpt) + '…</blockquote>'; }).join('') + '</div>';
    return '<div class="msg msg-bot">' + body + renderSources(m.sources || [], prefix) +
      (m.meta ? '<div class="meta-line">' + esc(m.meta) + '</div>' : '') + '</div>';
  }

  function secondsFromTimestamp(ts) {
    return String(ts || '').split(':').reduce(function (acc, part) { return acc * 60 + (parseInt(part, 10) || 0); }, 0);
  }

  function sourceUrl(s) {
    if (/[?&]t=/.test(s.videoUrl)) return s.videoUrl;
    return s.videoUrl + (s.videoUrl.indexOf('?') >= 0 ? '&' : '?') + 't=' + secondsFromTimestamp(s.timestamp) + 's';
  }

  function renderSources(sources, prefix) {
    if (!sources.length) return '';
    return '<div class="sources"><div class="sources-title">Sources</div><div class="source-list">' +
      sources.map(function (s, i) {
        var href = /^https?:\/\//.test(s.videoUrl) ? sourceUrl(s) : '#';
        return '<a class="source" id="' + prefix + (i + 1) + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
          '<span class="n">' + (i + 1) + '</span>' +
          '<span class="title">' + esc(s.videoTitle) + '</span>' +
          '<span class="ts">' + esc(s.timestamp) + '</span></a>';
      }).join('') + '</div></div>';
  }

  function scrollToEnd() {
    el.log.scrollTop = el.log.scrollHeight;
  }

  function appendHtml(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var node = wrap.firstElementChild;
    el.log.appendChild(node);
    scrollToEnd();
    return node;
  }

  function pushMessage(message) {
    message.id = ++state.msgSeq;
    state.conversations[state.current.id].push(message);
    return appendHtml(renderMessage(message));
  }

  function system(text, error) {
    var message = { role: 'system', content: text, error: !!error };
    // before a channel loads (e.g. 401 at boot) there is no conversation to keep it in
    return state.current ? pushMessage(message) : appendHtml(renderMessage(message));
  }

  function reveal(node) {
    if (reducedMotion) return;
    var blocks = node.querySelectorAll('.answer > *, .sources, .meta-line');
    blocks.forEach(function (b) { b.style.visibility = 'hidden'; });
    blocks.forEach(function (b, i) {
      setTimeout(function () { b.style.visibility = ''; scrollToEnd(); }, 45 * i);
    });
  }

  // ---------- thinking indicator ----------

  function startThinking() {
    var node = appendHtml('<div class="msg thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="step"></span></div>');
    var step = node.querySelector('.step');
    var chunks = formatCount(state.current.chunks);
    var stepIndex = 0;
    function setStep(i) { step.textContent = THINKING_STEPS[Math.min(i, THINKING_STEPS.length - 1)].replace('{chunks}', chunks) + '…'; }
    setStep(0);
    var stepTimer = setInterval(function () { setStep(++stepIndex); }, 1100);
    return function stop() {
      clearInterval(stepTimer);
      node.remove();
    };
  }

  // ---------- asking ----------

  function historyForRequest() {
    return state.conversations[state.current.id]
      .filter(function (m) { return (m.role === 'user' || m.role === 'assistant') && m.content; })
      .slice(-HISTORY_TURNS_SENT)
      .map(function (m) { return { role: m.role, content: m.content.slice(0, 4000) }; });
  }

  function metaLine(data) {
    var synthesis = (data.trace && data.trace.stages || []).find(function (s) { return s.stage === 'synthesis'; });
    var parts = [((data.trace && data.trace.totalMs) / 1000).toFixed(1) + 's', (data.sources || []).length + ' excerpts'];
    if (synthesis && synthesis.detail && synthesis.detail.model) parts.push(synthesis.detail.model);
    return parts.join(' · ');
  }

  function ask(question) {
    if (state.busy || !state.current) return;
    var channel = state.current;
    var history = historyForRequest();
    pushMessage({ role: 'user', content: question });
    setBusy(true);
    var stop = startThinking();

    api('/api/channels/' + encodeURIComponent(channel.id) + '/ask', { method: 'POST', body: { question: question, history: history } })
      .then(function (data) {
        stop();
        if (state.current.id !== channel.id) return;
        var node = pushMessage({ role: 'assistant', content: data.answer, sources: data.sources, meta: metaLine(data) });
        reveal(node);
        loadRecent();
      })
      .catch(function (error) {
        stop();
        setStatus('Something went wrong', 'error');
        system(error.message, true);
      })
      .finally(function () {
        if (state.busy) setBusy(false);
        if (el.status.classList.contains('error')) setTimeout(function () { if (!state.busy) setStatus(''); }, 3000);
      });
  }

  // ---------- commands ----------

  var HELP = [
    'commands:',
    '  /help              this list',
    '  /channels          list channels',
    '  /use <id>          switch channel',
    '  /suggest           new question ideas',
    '  /recent            your recent questions here',
    '  /clear             clear this conversation',
    '  /key <api-key>     set the server API key (stored in this browser)',
  ].join('\n');

  function runCommand(raw) {
    var parts = raw.trim().split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var arg = parts.slice(1).join(' ');
    if (cmd === '/key') {
      store(STORAGE.apiKey, arg || null);
      system(arg ? 'api key saved in this browser.' : 'api key cleared.');
      if (!state.current && !state.booting) boot();
      return;
    }
    if (!state.current) return system('not connected yet. if the server needs a key, type /key <your-key>.', true);
    switch (cmd) {
      case '/help': return system(HELP);
      case '/channels':
        return system(state.channels.map(function (c) { return (c.id === state.current.id ? '* ' : '  ') + c.id + '  ' + c.name + ' (' + c.topic + ')'; }).join('\n'));
      case '/use':
        if (state.busy) return system('wait for the current answer before switching channels.', true);
        if (!selectChannel(arg)) system('unknown channel: ' + arg + '. try /channels', true);
        return;
      case '/suggest':
        system('fresh ideas below ↑');
        loadSuggestions();
        el.log.scrollTop = 0;
        return;
      case '/recent':
        return system(state.recent.length ? state.recent.map(function (r, i) { return (i + 1) + '. ' + r.question; }).join('\n') : 'no searches yet');
      case '/clear':
        state.conversations[state.current.id] = [];
        return renderLog();
      default:
        return system('unknown command ' + cmd + '. type /help', true);
    }
  }

  // ---------- events ----------

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = el.input.value.trim();
    if (!value) return;
    if (state.busy && value.charAt(0) !== '/') return setStatus('Still answering, one moment…', 'busy');
    el.input.value = '';
    state.recall.index = -1;
    if (value.charAt(0) === '/') return runCommand(value);
    if (!state.current) return system('no channel selected yet.', true);
    if (value.length < 3) return system('ask a little more than that.', true);
    ask(value);
  });

  el.input.addEventListener('keydown', function (event) {
    var items = state.recall.items;
    if (!items.length || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    var next = state.recall.index + (event.key === 'ArrowUp' ? 1 : -1);
    state.recall.index = Math.max(-1, Math.min(items.length - 1, next));
    el.input.value = state.recall.index === -1 ? '' : items[state.recall.index];
  });

  el.channelList.addEventListener('click', function (event) {
    var button = event.target.closest('.channel');
    if (button && !state.busy) selectChannel(button.dataset.id);
  });

  el.recentList.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-q]');
    if (button) ask(button.dataset.q);
  });

  el.clearRecent.addEventListener('click', function () {
    if (!state.current) return;
    api('/api/channels/' + encodeURIComponent(state.current.id) + '/recent', { method: 'DELETE' })
      .then(function () { state.recent = []; state.recall = { items: [], index: -1 }; renderRecent(); })
      .catch(function (error) { system(error.message, true); });
  });

  el.log.addEventListener('click', function (event) {
    var suggestion = event.target.closest('.suggestion');
    if (suggestion) return ask(suggestion.dataset.q);
    if (event.target.closest('[data-action="reshuffle"]')) return loadSuggestions();
    var cite = event.target.closest('.cite');
    if (cite) {
      var target = document.getElementById(cite.getAttribute('href').slice(1));
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
        target.classList.add('flash');
        setTimeout(function () { target.classList.remove('flash'); }, 1200);
      }
    }
  });

  // ---------- boot ----------

  function boot() {
    state.booting = true;
    api('/api/channels')
      .then(function (channels) {
        state.channels = channels;
        var total = channels.reduce(function (sum, c) { return sum + (c.videos || 0); }, 0);
        el.topMeta.textContent = channels.length + ' channels · ' + total.toLocaleString() + ' videos';
        var fromUrl = new URLSearchParams(location.search).get('channel');
        var preferred = [fromUrl, load(STORAGE.channel), channels[0] && channels[0].id];
        for (var i = 0; i < preferred.length; i++) {
          if (preferred[i] && selectChannel(preferred[i])) return;
        }
        el.log.innerHTML = '';
        system('No channels configured yet. Add one to channels.json.', true);
      })
      .catch(function (error) {
        setStatus('Offline', 'error');
        el.topMeta.textContent = 'Offline';
        el.channelList.innerHTML = '<div class="muted small">Unavailable</div>';
        el.log.innerHTML = '';
        system(error.status === 401 ? error.message : 'Could not reach the server (' + error.message + '). Is it running?', true);
      })
      .finally(function () { state.booting = false; });
  }

  boot();
})();
