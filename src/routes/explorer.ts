import { Hono } from 'hono';
import { getDomain, type DomainProfile } from '../domains';

const explorer = new Hono();

/**
 * Self-contained query explorer UI. No build step — plain HTML/CSS/JS
 * served straight from the API so it always matches the running server.
 * Visualizes the /api/knowledge/ask pipeline stage by stage.
 */
explorer.get('/', (c) => c.html(renderExplorer(getDomain())));

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderExplorer(domain: DomainProfile): string {
  const presets = domain.exampleQuestions
    .map(q => `  <span class="preset" onclick="setQ(this)">${escapeHtml(q)}</span>`)
    .join('\n');
  const pipeline = domain.graphEnabled
    ? 'context extraction → pattern layer (Redis/Neo4j) + graph multi-hop (Neo4j) + vector search (ChromaDB) → LLM synthesis'
    : 'vector search (ChromaDB) → cited LLM synthesis';
  // function replacers: '$' in questions ("$10k MRR") must not be read as a replacement pattern
  return EXPLORER_HTML.replace('__DOMAIN_NAME__', () => escapeHtml(domain.name))
    .replace('__PIPELINE__', () => escapeHtml(pipeline))
    .replace('__PLACEHOLDER__', () => escapeHtml(domain.questionPlaceholder))
    .replace('__PRESETS__', () => presets);
}

const EXPLORER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Query Explorer — Knowledge Engine</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131722; --panel2: #1a2030; --border: #232a3d;
    --text: #e6e9f0; --dim: #8b93a7; --accent: #6c8cff; --green: #3fb27f;
    --red: #e05b5b; --amber: #d9a23d; --purple: #a06cff; --cyan: #3fb2b2;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: var(--dim); margin-bottom: 20px; font-size: 13px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  textarea, input { background: var(--panel); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 10px 12px; font: inherit; }
  textarea { width: 100%; resize: vertical; min-height: 60px; }
  input { flex: 1; min-width: 200px; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 10px 20px; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: wait; }
  .presets { margin: 10px 0 20px; display: flex; gap: 8px; flex-wrap: wrap; }
  .preset { background: var(--panel2); border: 1px solid var(--border); color: var(--dim); border-radius: 20px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .preset:hover { color: var(--text); border-color: var(--accent); }

  .pipeline { display: none; margin-top: 24px; }
  .pipeline.active { display: block; }
  .flow { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .parallel { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .stage { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; position: relative; }
  .stage h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between; align-items: center; }
  .stage h3 .ms { font-size: 12px; color: var(--dim); font-weight: 400; }
  .stage .body { margin-top: 10px; font-size: 13px; color: var(--dim); }
  .stage.ok { border-left: 3px solid var(--green); }
  .stage.failed { border-left: 3px solid var(--red); }
  .stage.skipped { border-left: 3px solid var(--amber); }
  .arrow { text-align: center; color: var(--dim); font-size: 18px; line-height: 1; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .chip { background: var(--panel2); border: 1px solid var(--border); border-radius: 14px; padding: 3px 10px; font-size: 12px; color: var(--text); }
  .chip b { color: var(--accent); }

  .bar-row { display: grid; grid-template-columns: 160px 1fr 60px; gap: 8px; align-items: center; margin: 4px 0; font-size: 12px; }
  .bar-row .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .bar-track { background: var(--panel2); border-radius: 4px; height: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-row .val { color: var(--dim); text-align: right; }

  .timeline { margin: 20px 0; }
  .timeline h2, section h2 { font-size: 15px; margin: 22px 0 10px; }
  .tl-row { display: grid; grid-template-columns: 150px 1fr 70px; gap: 10px; align-items: center; margin: 5px 0; font-size: 12px; }
  .tl-track { position: relative; background: var(--panel); border-radius: 4px; height: 14px; }
  .tl-fill { position: absolute; height: 100%; border-radius: 4px; min-width: 2px; }

  .answer { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px 22px; margin-top: 10px; line-height: 1.65; }
  .answer h2, .answer h3 { font-size: 15px; margin: 18px 0 8px; color: var(--text); }
  .answer h2:first-child, .answer h3:first-child { margin-top: 0; }
  .answer p { margin: 8px 0; }
  .answer ul, .answer ol { margin: 8px 0 8px 22px; }
  .answer li { margin: 5px 0; }
  .answer a { color: var(--accent); text-decoration: none; }
  .answer a:hover { text-decoration: underline; }
  .answer code { background: var(--panel2); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  .answer strong { color: #fff; }
  .answer hr { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }
  .answer blockquote { border-left: 3px solid var(--accent); margin: 8px 0; padding: 2px 12px; color: var(--dim); }
  .founder-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .founder-card .name { font-weight: 600; }
  .founder-card .meta { color: var(--dim); font-size: 12px; margin: 3px 0 6px; }
  .source { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 8px 0; }
  .source a { color: var(--accent); text-decoration: none; font-weight: 600; }
  .source .excerpt { color: var(--dim); font-size: 12px; margin-top: 6px; }
  details { margin-top: 24px; }
  summary { cursor: pointer; color: var(--dim); }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow-x: auto; font-size: 12px; margin-top: 10px; }
  .error-box { background: rgba(224,91,91,0.1); border: 1px solid var(--red); border-radius: 10px; padding: 14px; margin-top: 20px; display: none; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
</style>
</head>
<body>
<h1>🧠 Query Explorer — __DOMAIN_NAME__</h1>
<div class="sub">Watch the retrieval pipeline work: __PIPELINE__</div>

<textarea id="question" placeholder="__PLACEHOLDER__"></textarea>
<div class="row" style="margin-top:10px">
  <input id="apikey" type="password" placeholder="x-api-key (only if API_KEY is set on server)">
  <button id="askBtn" onclick="runQuery()">Ask</button>
</div>
<div class="presets">
__PRESETS__
</div>

<div class="error-box" id="errorBox"></div>

<div class="pipeline" id="pipeline">
  <div class="flow">
    <div class="stage" id="st-context"><h3>1 · Context Extraction <span class="ms"></span></h3><div class="body"></div></div>
    <div class="arrow">▼ &nbsp; parallel fan-out &nbsp; ▼</div>
    <div class="parallel">
      <div class="stage" id="st-patterns"><h3>2a · Pattern Layer <span class="ms"></span></h3><div class="body"></div></div>
      <div class="stage" id="st-graph"><h3>2b · Graph Multi-hop <span class="ms"></span></h3><div class="body"></div></div>
      <div class="stage" id="st-vector"><h3>2c · Vector Search <span class="ms"></span></h3><div class="body"></div></div>
    </div>
    <div class="arrow">▼</div>
    <div class="stage" id="st-synth"><h3>3 · LLM Synthesis <span class="ms"></span></h3><div class="body"></div></div>
  </div>

  <div class="timeline" id="timeline"></div>
  <section id="answerSec" style="display:none"><h2>💬 Answer</h2><div class="answer" id="answer"></div></section>
  <section id="patternsSec" style="display:none"><h2>📊 Patterns (graph aggregates for this context)</h2><div id="strategies"></div><div class="chips" id="tools"></div></section>
  <section id="examplesSec" style="display:none"><h2>👤 Similar Founders (multi-hop graph)</h2><div class="parallel" id="examples"></div></section>
  <section id="sourcesSec" style="display:none"><h2>🎬 Sources (semantic search, cosine similarity)</h2><div id="sources"></div></section>
  <details><summary>Raw response JSON</summary><pre id="rawJson"></pre></details>
</div>

<script>
var STAGE_COLORS = { 'context-extraction': 'var(--purple)', 'pattern-layer': 'var(--cyan)', 'graph-examples': 'var(--green)', 'vector-search': 'var(--accent)', 'synthesis': 'var(--amber)' };
var STAGE_IDS = { 'context-extraction': 'st-context', 'pattern-layer': 'st-patterns', 'graph-examples': 'st-graph', 'vector-search': 'st-vector', 'synthesis': 'st-synth' };

document.getElementById('apikey').value = localStorage.getItem('ke-apikey') || '';

function setQ(el) { document.getElementById('question').value = el.textContent; }
function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }

async function runQuery() {
  var q = document.getElementById('question').value.trim();
  if (!q) return;
  var btn = document.getElementById('askBtn');
  var errBox = document.getElementById('errorBox');
  btn.disabled = true; btn.textContent = 'Thinking…'; errBox.style.display = 'none';

  var key = document.getElementById('apikey').value;
  localStorage.setItem('ke-apikey', key);
  var headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;

  try {
    var res = await fetch('/api/knowledge/ask', { method: 'POST', headers: headers, body: JSON.stringify({ question: q }) });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || ('HTTP ' + res.status));
    render(json.data);
  } catch (e) {
    errBox.textContent = 'Request failed: ' + e.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Ask';
  }
}

function render(data) {
  document.getElementById('pipeline').classList.add('active');
  document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);

  // Stage cards
  (data.trace.stages || []).forEach(function(s) {
    var el = document.getElementById(STAGE_IDS[s.stage]);
    if (!el) return;
    el.className = 'stage ' + s.status;
    el.querySelector('.ms').textContent = s.status === 'skipped' ? 'skipped' : s.ms + ' ms';
    el.querySelector('.body').innerHTML = stageBody(s, data);
  });

  // Timeline
  var stages = data.trace.stages || [];
  var maxMs = Math.max.apply(null, stages.map(function(s){ return s.ms; }).concat([1]));
  var tl = '<h2>⏱ Stage timings (total ' + data.trace.totalMs + ' ms)</h2>';
  stages.forEach(function(s) {
    var w = Math.max(1, Math.round((s.ms / maxMs) * 100));
    tl += '<div class="tl-row"><div>' + esc(s.stage) + '</div><div class="tl-track"><div class="tl-fill" style="width:' + w + '%;background:' + (STAGE_COLORS[s.stage] || 'var(--dim)') + '"></div></div><div>' + s.ms + ' ms</div></div>';
  });
  document.getElementById('timeline').innerHTML = tl;

  // Answer
  var ansSec = document.getElementById('answerSec');
  if (data.answer) { ansSec.style.display = 'block'; document.getElementById('answer').innerHTML = renderMarkdown(data.answer); }
  else { ansSec.style.display = 'block'; document.getElementById('answer').innerHTML = '<i style="color:var(--dim)">No synthesized answer (no LLM key set or synthesis failed) — raw retrieval below.</i>'; }

  // Patterns
  var pats = data.patterns || {};
  var strategies = pats.topStrategies || [];
  var tools = pats.topTools || [];
  document.getElementById('patternsSec').style.display = (strategies.length || tools.length) ? 'block' : 'none';
  var maxUse = Math.max.apply(null, strategies.map(function(s){ return s.usage; }).concat([1]));
  document.getElementById('strategies').innerHTML = strategies.map(function(s) {
    var w = Math.round((s.usage / maxUse) * 100);
    return '<div class="bar-row"><div class="label" title="' + esc(s.name) + '">' + esc(s.name) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + w + '%;background:var(--cyan)"></div></div><div class="val">' + s.usage + '× · ' + pct(s.successRate) + '</div></div>';
  }).join('');
  document.getElementById('tools').innerHTML = tools.map(function(t) {
    return '<span class="chip">' + esc(t.name) + ' <b>' + t.usage + '×</b></span>';
  }).join('');

  // Founder examples
  var ex = data.examples || [];
  document.getElementById('examplesSec').style.display = ex.length ? 'block' : 'none';
  document.getElementById('examples').innerHTML = ex.map(function(f) {
    var out = f.outcome ? ((f.outcome.mrr ? '$' + f.outcome.mrr.toLocaleString() + ' MRR' : '') + (f.outcome.users ? ' · ' + f.outcome.users.toLocaleString() + ' users' : '') + (f.outcome.timeline ? ' · ' + esc(f.outcome.timeline) : '')) : 'outcome unknown';
    var vid = f.videoUrl ? ' · <a href="' + esc(f.videoUrl) + '" target="_blank" style="color:var(--accent)">video</a>' : '';
    return '<div class="founder-card"><div class="name">' + esc(f.founder) + ' — ' + esc(f.startup) + '</div><div class="meta">' + esc(f.startupType || '') + ' · ' + esc(f.stage || '') + ' · ' + out + vid + '</div><div class="chips">' + (f.strategies || []).slice(0,4).map(function(s){ return '<span class="chip">' + esc(s) + '</span>'; }).join('') + '</div></div>';
  }).join('');

  // Sources
  var srcs = data.sources || [];
  document.getElementById('sourcesSec').style.display = srcs.length ? 'block' : 'none';
  document.getElementById('sources').innerHTML = srcs.map(function(s) {
    var simW = Math.round((s.similarity || 0) * 100);
    return '<div class="source"><a href="' + esc(s.videoUrl) + '" target="_blank">' + esc(s.videoTitle) + '</a> <span style="color:var(--dim);font-size:12px">@ ' + esc(s.timestamp) + '</span>' +
      '<div class="bar-row" style="grid-template-columns: 80px 1fr 50px"><div class="label" style="color:var(--dim)">similarity</div><div class="bar-track"><div class="bar-fill" style="width:' + simW + '%;background:var(--accent)"></div></div><div class="val">' + (s.similarity || 0).toFixed(2) + '</div></div>' +
      '<div class="excerpt">' + esc(s.excerpt) + '…</div></div>';
  }).join('');
}

function renderMarkdown(md) {
  var lines = esc(md).split('\\n');
  var html = [], inUl = false, inOl = false, para = [];
  function inline(t) {
    return t
      .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
      .replace(/\\u0060([^\\u0060]+)\\u0060/g, '<code>$1</code>');
  }
  function closeLists() {
    if (inUl) { html.push('</ul>'); inUl = false; }
    if (inOl) { html.push('</ol>'); inOl = false; }
  }
  function flushPara() {
    if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
  }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var h = l.match(/^(#{1,4})\\s+(.*)$/);
    var ul = l.match(/^\\s*[-*]\\s+(.*)$/);
    var ol = l.match(/^\\s*\\d+\\.\\s+(.*)$/);
    if (h) { flushPara(); closeLists(); html.push('<h3>' + inline(h[2]) + '</h3>'); }
    else if (/^\\s*(---+|___+)\\s*$/.test(l)) { flushPara(); closeLists(); html.push('<hr>'); }
    else if (ul) { flushPara(); if (inOl) { html.push('</ol>'); inOl = false; } if (!inUl) { html.push('<ul>'); inUl = true; } html.push('<li>' + inline(ul[1]) + '</li>'); }
    else if (ol) { flushPara(); if (inUl) { html.push('</ul>'); inUl = false; } if (!inOl) { html.push('<ol>'); inOl = true; } html.push('<li>' + inline(ol[1]) + '</li>'); }
    else if (l.match(/^\\s*&gt;\\s?(.*)$/)) { flushPara(); closeLists(); html.push('<blockquote>' + inline(l.replace(/^\\s*&gt;\\s?/, '')) + '</blockquote>'); }
    else if (l.trim() === '') { flushPara(); closeLists(); }
    else { para.push(l.trim()); }
  }
  flushPara(); closeLists();
  return html.join('\\n');
}

function relaxNote(filters) {
  if (!filters || !filters.length) return '';
  return '<br><span style="color:var(--amber);font-size:11px">↓ relaxed filters: ' + filters.map(esc).join(', ') + ' (exact context matched nothing)</span>';
}

function stageBody(s, data) {
  var d = s.detail || {};
  if (s.stage === 'context-extraction') {
    var ctx = d.context || {};
    var chips = Object.keys(ctx).map(function(k) { return '<span class="chip">' + esc(k) + ': <b>' + esc(ctx[k]) + '</b></span>'; }).join('');
    return 'method: <b>' + esc(d.method) + '</b>' + (chips ? '<div class="chips">' + chips + '</div>' : '<div class="chips"><span class="chip" style="color:var(--dim)">no context detected — global patterns used</span></div>');
  }
  if (s.stage === 'pattern-layer') {
    return (d.fromCache ? '⚡ <b>Redis cache HIT</b>' : '🔄 cache miss → live Neo4j aggregation') +
      '<br>key: <code>' + esc(d.cacheKey) + '</code><br>' + d.strategies + ' strategies · ' + d.tools + ' tools · ' + d.workflows + ' workflows · ' + d.foundersWithOutcomes + ' founders w/ outcomes' + relaxNote(d.relaxedFilters);
  }
  if (s.stage === 'graph-examples') {
    return (s.status === 'failed' ? '⚠️ Neo4j unreachable<br>' : '') + '<b>' + d.founders + '</b> matching founders' + relaxNote(d.relaxedFilters) + '<br><span style="font-size:11px">' + esc(d.hops) + '</span>';
  }
  if (s.stage === 'vector-search') {
    return (s.status === 'failed' ? '⚠️ ChromaDB unreachable<br>' : '') + '<b>' + d.chunks + '</b> chunks retrieved<br>top sim: ' + (d.topSimilarity != null ? d.topSimilarity.toFixed(3) : '—') + ' · avg: ' + (d.avgSimilarity != null ? d.avgSimilarity.toFixed(3) : '—') + '<br><span style="font-size:11px">' + esc(d.embedder) + '</span>';
  }
  if (s.stage === 'synthesis') {
    if (s.status === 'skipped') return '⏭ ' + esc(d.reason);
    if (s.status === 'failed') return '⚠️ ' + esc(d.error);
    return 'model: <b>' + esc(d.model) + '</b><br>prompt: ' + (d.promptTokens || '?') + ' tokens · completion: ' + (d.completionTokens || '?') + ' tokens';
  }
  return '';
}

document.getElementById('question').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runQuery();
});
</script>
</body>
</html>`;

export default explorer;
