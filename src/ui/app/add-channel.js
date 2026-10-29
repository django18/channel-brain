/**
 * "Add channel" dialog. Talks to POST /api/channels through the api()
 * helper app.js passes in, and hands the created channel back.
 */
(function (global) {
  'use strict';

  var VIDEO_OPTIONS = [
    { value: 50, label: 'Latest 50 videos', hint: 'about 5 minutes' },
    { value: 200, label: 'Latest 200 videos', hint: 'about 20 minutes' },
    { value: 500, label: 'Latest 500 videos', hint: 'about 1 hour' },
    { value: 5000, label: 'All videos', hint: 'can take hours for big channels' },
  ];
  var DEFAULT_VIDEOS = 200;

  var api = null;
  var onCreated = null;
  var root = null;
  var lastFocus = null;

  function esc(text) { return global.Markdown.escapeHtml(text); }

  function template() {
    return '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="addTitle">' +
      '<h2 id="addTitle">Add a YouTube channel</h2>' +
      '<p class="modal-sub">We\'ll read the channel\'s video transcripts and build a searchable knowledge base. You can start asking while it builds.</p>' +
      '<form id="addForm" novalidate>' +
      '<label class="field"><span>Channel link</span>' +
      '<input id="addUrl" name="channelUrl" type="text" placeholder="youtube.com/@channel or @handle" autocomplete="off" spellcheck="false" required></label>' +
      '<label class="field"><span>Topic <em>optional</em></span>' +
      '<input id="addTopic" name="topic" type="text" maxlength="60" placeholder="e.g. Personal finance"></label>' +
      '<label class="field"><span>How much to index</span><select id="addVideos" name="maxVideos">' +
      VIDEO_OPTIONS.map(function (o) {
        return '<option value="' + o.value + '"' + (o.value === DEFAULT_VIDEOS ? ' selected' : '') + '>' + esc(o.label) + ' (' + esc(o.hint) + ')</option>';
      }).join('') +
      '</select></label>' +
      '<div class="form-error" id="addError" role="alert" hidden></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="addSubmit">Add channel</button>' +
      '</div></form></div>';
  }

  function showError(message) {
    var box = root.querySelector('#addError');
    box.textContent = message;
    box.hidden = !message;
  }

  function setPending(pending) {
    var button = root.querySelector('#addSubmit');
    button.disabled = pending;
    button.textContent = pending ? 'Checking channel…' : 'Add channel';
    root.querySelectorAll('input, select').forEach(function (field) { field.disabled = pending; });
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab' || !root) return;
    // keep focus inside the dialog
    var focusable = root.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function submit(event) {
    event.preventDefault();
    var url = root.querySelector('#addUrl').value.trim();
    var topic = root.querySelector('#addTopic').value.trim();
    var maxVideos = parseInt(root.querySelector('#addVideos').value, 10);
    if (!url) return showError('Paste a channel link or @handle.');
    showError('');
    setPending(true);
    api('/api/channels', { method: 'POST', body: { channelUrl: url, topic: topic || undefined, maxVideos: maxVideos } })
      .then(function (channel) {
        close();
        onCreated(channel);
      })
      .catch(function (error) {
        if (!root) return;
        setPending(false);
        if (error.status === 409 && error.data && error.data.id) {
          close();
          onCreated({ id: error.data.id, existing: true });
          return;
        }
        showError(error.message);
        root.querySelector('#addUrl').focus();
      });
  }

  function open() {
    if (root) return;
    lastFocus = document.activeElement;
    root = document.createElement('div');
    root.className = 'modal-root';
    root.innerHTML = template();
    document.body.appendChild(root);
    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-close]')) close();
    });
    root.querySelector('#addForm').addEventListener('submit', submit);
    document.addEventListener('keydown', onKey);
    root.querySelector('#addUrl').focus();
  }

  global.AddChannel = {
    init: function (options) {
      api = options.api;
      onCreated = options.onCreated;
    },
    open: open,
  };
})(window);
