import React from "react";
import { ConnectedComputerUseStudio } from "./ConnectedComputerUseStudio";
import type { ComputerUseStudioProps } from "./types";

/**
 * Computer Use Studio. Always live data: the simulated showcase that used to sit behind a
 * `demo` prop (a fake session, invented latency, fps and confidence figures) was removed,
 * since nothing mounted it and it described capabilities the backend does not have.
 */
export const ComputerUseStudio: React.FC<ComputerUseStudioProps> = (props) => (
  <ConnectedComputerUseStudio key={`${props.organizationId ?? "current"}:${props.sessionId ?? "select"}`} {...props} />
);

export default ComputerUseStudio;
