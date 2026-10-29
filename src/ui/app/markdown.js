/**
 * Minimal, escape-first markdown renderer for model answers.
 * Everything is HTML-escaped before any tag is produced, links must be
 * http(s), and [n] citations become anchors to the message's sources.
 */
(function (global) {
  'use strict';

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text, citePrefix) {
    // links become placeholders first so later rules never touch their URLs
    var links = [];
    var out = text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (_, label, url) {
        links.push({ label: label, url: url });
        return '\u0000' + (links.length - 1) + '\u0000';
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[(\d{1,2})\](?!\()/g, function (_, n) {
        return citePrefix
          ? '<a class="cite" href="#' + citePrefix + n + '" data-cite="' + n + '">' + n + '</a>'
          : '[' + n + ']';
      });
    return out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      var link = links[Number(i)];
      if (!link) return '';
      return '<a href="' + link.url + '" target="_blank" rel="noopener">' + link.label + '</a>';
    });
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }

  function render(markdown, citePrefix) {
    var lines = escapeHtml(markdown).split('\n');
    var html = [];
    var para = [];
    var list = null; // 'ul' | 'ol'

    function flushPara() {
      if (para.length) { html.push('<p>' + inline(para.join(' '), citePrefix) + '</p>'); para = []; }
    }
    function closeList() {
      if (list) { html.push('</' + list + '>'); list = null; }
    }
    function openList(kind) {
      if (list !== kind) { closeList(); html.push('<' + kind + '>'); list = kind; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var heading = line.match(/^(#{1,4})\s+(.*)$/);
      var bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);

      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flushPara(); closeList();
        var head = splitRow(line);
        var rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        i--;
        html.push('<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return '<th>' + inline(c, citePrefix) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c, citePrefix) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>');
      } else if (heading) {
        flushPara(); closeList();
        html.push('<h4>' + inline(heading[2], citePrefix) + '</h4>');
      } else if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushPara(); closeList();
        html.push('<hr>');
      } else if (bullet) {
        flushPara(); openList('ul');
        html.push('<li>' + inline(bullet[1], citePrefix) + '</li>');
      } else if (ordered) {
        flushPara(); openList('ol');
        html.push('<li>' + inline(ordered[1], citePrefix) + '</li>');
      } else if (/^\s*&gt;\s?/.test(line)) {
        flushPara(); closeList();
        html.push('<blockquote>' + inline(line.replace(/^\s*&gt;\s?/, ''), citePrefix) + '</blockquote>');
      } else if (line.trim() === '') {
        flushPara(); closeList();
      } else {
        para.push(line.trim());
      }
    }
    flushPara(); closeList();
    return html.join('\n');
  }

  global.Markdown = { render: render, escapeHtml: escapeHtml };
})(window);
