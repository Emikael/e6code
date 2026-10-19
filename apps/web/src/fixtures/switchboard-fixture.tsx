import { createRoot } from "react-dom/client";
import { SwitchboardFixture } from "./SwitchboardFixture";

const root = createRoot(document.getElementById("root")!);
root.render(<SwitchboardFixture />);
import.meta.hot?.dispose(() => root.unmount());
