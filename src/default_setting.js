/**
 * default_setting.js
 * Default colors, text sizes and layout of the graph. The DEFAULT_* ones can be overridden
 * with the create_graph option named in its comment.
 */

// Color of the node picked in "Select a node" (options.selectedColor)
export const DEFAULT_SELECTED_COLOR = '#e91e63';
// "Track node" chain colors (options.parentsColor, options.childrenColor)
export const DEFAULT_TRACK1_PARENTS_COLOR = '#2e7d32';
export const DEFAULT_TRACK1_CHILDREN_COLOR = '#7b1fa2';
// "Track node 2" chain colors (options.track2ParentsColor, options.track2ChildrenColor).
// Nodes and edges on both chains are drawn in DEFAULT_TRACK_COMMON_COLOR.
export const DEFAULT_TRACK2_PARENTS_COLOR = '#efeb00';
export const DEFAULT_TRACK2_CHILDREN_COLOR = '#773600be';
// Color of nodes and edges common to both tracks: rgb(239, 108, 0) (options.commonColor)
export const DEFAULT_TRACK_COMMON_COLOR = 'rgb(239, 108, 0)';
// Reports per row when the layout is built from the folders (options.layoutColumns)
export const DEFAULT_LAYOUT_COLUMNS = 10;
// Text size of the top controls row: "Select a node", "Track node", ... (options.topControlsFontSize)
export const DEFAULT_TOP_CONTROLS_FONT_SIZE = '22px';
// Text size of the right details panel (options.rightDisplayFontSize)
export const DEFAULT_RIGHT_DISPLAY_FONT_SIZE = '18px';

// ---- Fixed colors (not create_graph options) ----

// Base color of the graph: node text, node borders, edges and arrows (blue)
export const GRAPH_COLOR = '#0066cc';
// Fill of a report box
export const REPORT_BACKGROUND_COLOR = '#fff';
// Fill of a folder (group) box
export const FOLDER_BACKGROUND_COLOR = '#f0f8ff';
