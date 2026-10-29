import React, { useState } from "react";
import { createRoot } from "react-dom/client";

function ControlledInput() {
  const [value, setValue] = useState("");
  return (
    <label>
      React controlled input
      <input
        id="target"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}

createRoot(document.getElementById("root")).render(<ControlledInput />);
