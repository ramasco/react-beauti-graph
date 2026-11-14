/**
 * svg.ts
 * Exports the graph as a static SVG picture, drawn from the same boxes and colors as the screen.
 */

import { GRAPH_COLOR } from './default_setting.ts';
import { GROUP_FILL, LABEL_FONT_FAMILY, arrowPath, edgeSegment, loopPath } from './graph.ts';
import type { Appearance, Rect } from './graph.ts';

/** A group box to draw. */
export interface SvgGroup {
  rect: Rect;
  label: string;
  fontSize: number;
}

/** A report box to draw. */
export interface SvgReport {
  rect: Rect;
  label: string;
  fontSize: number;
  look: Appearance;
}

/** An arrow to draw, between two boxes (or from a box to itself). */
export interface SvgEdge {
  source: Rect;
  target: Rect;
  twoWay: boolean;
  look: Appearance;
}

/** Space (px) kept around the drawing */
const MARGIN = 30;
/** Room above a box for the loop of an arrow from a report to itself */
const LOOP_ROOM = 80;

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The graph as the text of an SVG file.
 * @param {SvgGroup[]} groups - Group boxes
 * @param {SvgReport[]} reports - Report boxes
 * @param {SvgEdge[]} edges - Arrows
 * @returns {string} SVG markup
 */
export function buildSvg(groups: SvgGroup[], reports: SvgReport[], edges: SvgEdge[]): string {
  const boxes = [...groups.map((g) => g.rect), ...reports.map((r) => r.rect)];
  const left = Math.min(...boxes.map((b) => b.x), 0) - MARGIN;
  const top =
    Math.min(...boxes.map((b) => b.y), 0) -
    MARGIN -
    (edges.some((e) => e.source === e.target) ? LOOP_ROOM : 0);
  const right = Math.max(...boxes.map((b) => b.x + b.width), 1) + MARGIN;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height), 1) + MARGIN;
  const width = Math.ceil(right - left);
  const height = Math.ceil(bottom - top);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" font-family="${LABEL_FONT_FAMILY}">`,
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];

  for (const { rect, label, fontSize } of groups) {
    parts.push(
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${GROUP_FILL}" fill-opacity="0.5" stroke="${GRAPH_COLOR}" stroke-width="2" stroke-dasharray="6 4"/>`,
      `<text x="${rect.x + rect.width / 2}" y="${rect.y + fontSize + 4}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="${GRAPH_COLOR}">${escapeXml(label)}</text>`
    );
  }

  for (const { source, target, twoWay, look } of edges) {
    const stroke = `stroke="${look.color}" stroke-width="${look.width}" opacity="${look.opacity}"`;
    if (source === target) {
      const loop = loopPath(source);
      parts.push(
        `<path d="${loop.d}" fill="none" ${stroke}/>`,
        `<path d="${arrowPath(loop.tip.x, loop.tip.y, loop.angle)}" fill="${look.color}" opacity="${look.opacity}"/>`
      );
      continue;
    }
    const { x1, y1, x2, y2 } = edgeSegment(source, target);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${stroke}/>`,
      `<path d="${arrowPath(x2, y2, angle)}" fill="${look.color}" opacity="${look.opacity}"/>`
    );
    if (twoWay) {
      parts.push(
        `<path d="${arrowPath(x1, y1, angle + Math.PI)}" fill="${look.color}" opacity="${look.opacity}"/>`
      );
    }
  }

  for (const { rect, label, fontSize, look } of reports) {
    parts.push(
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${look.fill}" stroke="${look.color}" stroke-width="${look.width}" opacity="${look.opacity}"/>`,
      `<text x="${rect.x + rect.width / 2}" y="${rect.y + rect.height / 2}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" fill="${GRAPH_COLOR}" opacity="${look.opacity}">${escapeXml(label)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** Downloads SVG markup as a file named graph.svg. */
export function downloadSvg(markup: string): void {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'graph.svg';
  link.click();
  URL.revokeObjectURL(url);
}
