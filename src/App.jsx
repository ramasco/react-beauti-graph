import { create_graph } from './graphFactory';
// Demo data: switch the two imports for the 100-report example
import { folders, direct_node_connections } from './samples/sampleSmallGraphData';
// import { folders, direct_node_connections } from './samples/sampleBigGraphData';

// Grid spacing. Colors and text sizes use the DEFAULT_... values in default_setting.js;
// set an option here (e.g. parentsColor, topControlsFontSize) only to override one.
const options = { offsetX: 280, offsetY: 160 };

const MyGraph = create_graph(folders, direct_node_connections, options);

export default function App() {
  return <MyGraph />;
}
