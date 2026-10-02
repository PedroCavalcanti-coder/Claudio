import {
  addTool,
  ToolGroupManager,
  Enums as csToolsEnums,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  RectangleROITool,
  ArrowAnnotateTool,
  BidirectionalTool,
  CobbAngleTool,
  ProbeTool,
} from '@cornerstonejs/tools';
import type { ToolName } from '../viewerTypes';

export const TOOL_GROUP_ID = 'RIS_PACS_VIEWER_TG';
const { MouseBindings } = csToolsEnums;

let registered = false;

export function registerAllTools() {
  if (registered) return;
  registered = true;

  const tools = [
    WindowLevelTool, PanTool, ZoomTool, StackScrollTool,
    LengthTool, AngleTool, EllipticalROITool, RectangleROITool,
    ArrowAnnotateTool, BidirectionalTool, CobbAngleTool, ProbeTool,
    ];
  tools.forEach(t => { try { addTool(t); } catch { /* já registrada (HMR / múltiplas montagens) */ } });
}

export function createToolGroup(viewportIds: string[]): string {
  // destrói grupo anterior para evitar bindings duplicados/orfãos em remontagens
  try { ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID); } catch { /* ok */ }

  const tg = ToolGroupManager.createToolGroup(TOOL_GROUP_ID)!;

  tg.addTool(WindowLevelTool.toolName);
  tg.addTool(PanTool.toolName);
  tg.addTool(ZoomTool.toolName);
  tg.addTool(StackScrollTool.toolName);
  tg.addTool(LengthTool.toolName);
  tg.addTool(AngleTool.toolName);
  tg.addTool(EllipticalROITool.toolName);
  tg.addTool(RectangleROITool.toolName);
  tg.addTool(ArrowAnnotateTool.toolName);
  tg.addTool(BidirectionalTool.toolName);
  tg.addTool(CobbAngleTool.toolName);
  tg.addTool(ProbeTool.toolName);

  tg.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary }],
  });
  tg.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }],
  });
  tg.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }],
  });
  tg.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }],
  });

  // passivo: ferramenta fica visível/editável mas não é acionada pelo botão primário do mouse
  tg.setToolPassive(LengthTool.toolName);
  tg.setToolPassive(AngleTool.toolName);
  tg.setToolPassive(EllipticalROITool.toolName);
  tg.setToolPassive(RectangleROITool.toolName);
  tg.setToolPassive(ArrowAnnotateTool.toolName);
  tg.setToolPassive(BidirectionalTool.toolName);
  tg.setToolPassive(CobbAngleTool.toolName);
  tg.setToolPassive(ProbeTool.toolName);

  viewportIds.forEach(id => tg.addViewport(id));

  return TOOL_GROUP_ID;
}

export function setActiveTool(toolName: ToolName) {
  const tg = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!tg) return;

  const annotationTools: ToolName[] = [
    'Length', 'Angle', 'EllipticalROI', 'RectangleROI',
    'ArrowAnnotate', 'Bidirectional', 'CobbAngle', 'Probe',
  ];

  annotationTools.forEach(name => {
    try { tg.setToolPassive(name); } catch { /* ok */ }
  });

  if (toolName === 'WindowLevel') {
    tg.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  } else if (toolName === 'Pan') {
    tg.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  } else if (toolName === 'Zoom') {
    tg.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  } else {
    tg.setToolActive(toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
  }
}

export { StackScrollTool };
