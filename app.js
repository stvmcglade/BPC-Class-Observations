const STORAGE_KEY = "lesson-observation-dashboard-state";
const TOOL_TYPES = {
  question: "Question",
  disruption: "Disruption",
};
const PDF_PAGE_WIDTH = 1191;
const PDF_PAGE_HEIGHT = 842;
const PDF_COLORS = {
  page: [1, 1, 1],
  panel: [0.968, 0.976, 0.986],
  panelStrong: [0.942, 0.955, 0.972],
  text: [0.11, 0.16, 0.22],
  muted: [0.36, 0.43, 0.5],
  line: [0.8, 0.84, 0.88],
  green: [0.133, 0.773, 0.369],
  amber: [0.961, 0.62, 0.043],
  blue: [0.376, 0.647, 0.98],
  red: [0.973, 0.443, 0.443],
  slate: [0.875, 0.906, 0.941],
  darkSlate: [0.19, 0.28, 0.36],
  white: [1, 1, 1],
};

const observationToggle = document.getElementById("observationToggle");
const directInstructionToggle = document.getElementById("directInstructionToggle");
const endSessionDownloadButton = document.getElementById("endSessionDownload");
const downloadPdfReportButton = document.getElementById("downloadPdfReport");
const resetSessionButton = document.getElementById("resetSession");
const undoLastEventButton = document.getElementById("undoLastEvent");
const observationNotes = document.getElementById("observationNotes");
const heatmapSurface = document.getElementById("heatmapSurface");
const heatmapOverlay = document.getElementById("heatmapOverlay");
const tapHint = document.getElementById("tapHint");
const eventLogBody = document.getElementById("eventLogBody");
const toolButtons = [...document.querySelectorAll(".tool-button")];

const observationTime = document.getElementById("observationTime");
const directInstructionTime = document.getElementById("directInstructionTime");
const instructionShare = document.getElementById("instructionShare");
const instructionStatus = document.getElementById("instructionStatus");
const segmentCount = document.getElementById("segmentCount");
const instructionProgress = document.getElementById("instructionProgress");
const questionTotal = document.getElementById("questionTotal");
const disruptionTotal = document.getElementById("disruptionTotal");
const questionRate = document.getElementById("questionRate");
const disruptionRate = document.getElementById("disruptionRate");
const directEventShare = document.getElementById("directEventShare");
const timeBreakdownChart = document.getElementById("timeBreakdownChart");
const timelineChart = document.getElementById("timelineChart");

function defaultState() {
  return {
    selectedTool: "question",
    observationRunning: false,
    observationStartedAt: null,
    observationElapsedMs: 0,
    directRunning: false,
    directStartedAt: null,
    directElapsedMs: 0,
    directSegments: 0,
    sessionEndedAt: null,
    notes: "",
    events: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultState();
    }

    const parsed = JSON.parse(raw);
    const initial = defaultState();

    return {
      ...initial,
      ...parsed,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch (error) {
    console.error("Failed to load dashboard state", error);
    return defaultState();
  }
}

let state = loadState();
let pdfDownloadInProgress = false;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatMinutes(ms) {
  return `${(ms / 60000).toFixed(1)} min`;
}

function formatTapPosition(point, rounded = true) {
  if (!point) {
    return "Legacy entry";
  }

  const xValue = rounded ? Math.round(point.xPercent) : point.xPercent.toFixed(1);
  const yValue = rounded ? Math.round(point.yPercent) : point.yPercent.toFixed(1);
  return `${xValue}%, ${yValue}%`;
}

function clearEndedSessionFlag() {
  state.sessionEndedAt = null;
}

function hasEndedSession() {
  return Boolean(state.sessionEndedAt);
}

function getSessionAnalytics(now = Date.now()) {
  const observationMs = getObservationElapsed(now);
  const totals = getTotals();
  const observedMinutes = observationMs / 60000;
  const questionPer5 = observedMinutes > 0 ? (totals.question / observedMinutes) * 5 : 0;
  const disruptionPer5 = observedMinutes > 0 ? (totals.disruption / observedMinutes) * 5 : 0;
  const directEvents = state.events.filter((event) => event.duringDirectInstruction).length;
  const totalEvents = state.events.length;
  const directShareValue = totalEvents === 0 ? 0 : Math.round((directEvents / totalEvents) * 100);

  return {
    questionPer5,
    disruptionPer5,
    directEvents,
    totalEvents,
    directShareValue,
  };
}


function escapePdfText(text) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapText(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > maxChars && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    currentLine = nextLine;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapTextPreserveLineBreaks(text, maxChars) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .flatMap((line) => {
      if (line === "") {
        return [""];
      }

      return wrapText(line, maxChars);
    });
}

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    merged.set(part, offset);
    offset += part.length;
  });

  return merged;
}

function pdfStringBytes(value) {
  return new TextEncoder().encode(value);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildImagePdfBlob(imagePages) {
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const imageIds = [];
  const contentIds = [];
  const pageIds = [];

  imagePages.forEach((imagePage, index) => {
    const imageHeader = pdfStringBytes(
      `<< /Type /XObject /Subtype /Image /Width ${imagePage.pixelWidth} /Height ${imagePage.pixelHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imagePage.bytes.length} >>\nstream\n`
    );
    const imageFooter = pdfStringBytes("\nendstream");
    imageIds[index] = addObject(concatUint8Arrays([imageHeader, imagePage.bytes, imageFooter]));

    const contentStream =
      `q\n${imagePage.drawWidth.toFixed(2)} 0 0 ${imagePage.drawHeight.toFixed(2)} ` +
      `${imagePage.x.toFixed(2)} ${imagePage.y.toFixed(2)} cm\n/Im${index + 1} Do\nQ`;

    contentIds[index] = addObject(
      pdfStringBytes(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`)
    );
    pageIds[index] = addObject(new Uint8Array());
  });

  const pagesId = addObject(new Uint8Array());
  const catalogId = addObject(pdfStringBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));

  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = pdfStringBytes(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /XObject << /Im${index + 1} ${imageIds[index]} 0 R >> >> ` +
      `/Contents ${contentIds[index]} 0 R >>`
    );
  });

  objects[pagesId - 1] = pdfStringBytes(
    `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pageIds.length} >>`
  );

  const header = pdfStringBytes("%PDF-1.4\n");
  const offsets = [0];
  const bodyParts = [header];
  let byteOffset = header.length;

  objects.forEach((object, index) => {
    const objectHeader = pdfStringBytes(`${index + 1} 0 obj\n`);
    const objectFooter = pdfStringBytes("\nendobj\n");
    offsets.push(byteOffset);
    bodyParts.push(objectHeader, object, objectFooter);
    byteOffset += objectHeader.length + object.length + objectFooter.length;
  });

  const xrefStart = byteOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  bodyParts.push(pdfStringBytes(xref));

  return new Blob([concatUint8Arrays(bodyParts)], { type: "application/pdf" });
}

function buildPdfBlob(pageContents, pageImages = []) {
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];
  const contentIds = [];
  const imageResources = [];

  pageContents.forEach((pageContent, pageIndex) => {
    const images = pageImages[pageIndex] || [];
    imageResources[pageIndex] = images.map((image, imageIndex) => {
      const imageName = image.name || `Im${pageIndex + 1}_${imageIndex + 1}`;
      const imageHeader = pdfStringBytes(
        `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`
      );
      const imageFooter = pdfStringBytes("\nendstream");
      const imageId = addObject(concatUint8Arrays([imageHeader, image.bytes, imageFooter]));
      return { name: imageName, id: imageId };
    });

    const stream = `<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`;
    contentIds.push(addObject(stream));
    pageIds.push(addObject(""));
  });

  const pagesId = addObject("");
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  pageIds.forEach((pageId, index) => {
    const xObjectBlock = imageResources[index].length
      ? `/XObject << ${imageResources[index].map((image) => `/${image.name} ${image.id} 0 R`).join(" ")} >> `
      : "";

    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> ${xObjectBlock}>> ` +
      `/Contents ${contentIds[index]} 0 R >>`;
  });

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const header = pdfStringBytes("%PDF-1.4\n");
  const offsets = [0];
  const bodyParts = [header];
  let byteOffset = header.length;

  objects.forEach((object, index) => {
    const objectHeader = pdfStringBytes(`${index + 1} 0 obj\n`);
    const objectBody = object instanceof Uint8Array ? object : pdfStringBytes(String(object));
    const objectFooter = pdfStringBytes("\nendobj\n");
    offsets.push(byteOffset);
    bodyParts.push(objectHeader, objectBody, objectFooter);
    byteOffset += objectHeader.length + objectBody.length + objectFooter.length;
  });

  const xrefStart = byteOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  bodyParts.push(pdfStringBytes(xref));

  return new Blob([concatUint8Arrays(bodyParts)], { type: "application/pdf" });
}

function createPdfPage() {
  return { commands: [] };
}

function formatPdfColor(color) {
  return color.map((value) => value.toFixed(3)).join(" ");
}

function mixPdfColors(baseColor, targetColor, targetShare) {
  return baseColor.map((value, index) =>
    value + (targetColor[index] - value) * targetShare
  );
}

function buildPdfHeatmapClusters(roomX, roomY, roomWidth, roomHeight) {
  const markerInset = 8;
  const clusterDistance = 18;
  const clusters = [];

  state.events
    .slice(0, 80)
    .reverse()
    .forEach((event) => {
      if (!event.point) {
        return;
      }

      const eventX =
        roomX + markerInset + (clamp(event.point.xPercent, 0, 100) / 100) * (roomWidth - markerInset * 2);
      const eventY =
        roomY + markerInset + (clamp(event.point.yPercent, 0, 100) / 100) * (roomHeight - markerInset * 2);

      const existingCluster = clusters.find((cluster) => {
        if (cluster.type !== event.type) {
          return false;
        }

        const deltaX = cluster.x - eventX;
        const deltaY = cluster.y - eventY;
        return Math.hypot(deltaX, deltaY) <= clusterDistance;
      });

      if (existingCluster) {
        const nextCount = existingCluster.count + 1;
        existingCluster.x = (existingCluster.x * existingCluster.count + eventX) / nextCount;
        existingCluster.y = (existingCluster.y * existingCluster.count + eventY) / nextCount;
        existingCluster.count = nextCount;
        return;
      }

      clusters.push({
        type: event.type,
        x: eventX,
        y: eventY,
        count: 1,
      });
    });

  return clusters;
}

function drawPdfRect(page, x, y, width, height, options = {}) {
  const pdfY = PDF_PAGE_HEIGHT - y - height;
  const lineWidth = options.lineWidth || 1;
  const hasFill = Boolean(options.fillColor);
  const hasStroke = Boolean(options.strokeColor);
  let command = `q ${lineWidth} w `;

  if (hasFill) {
    command += `${formatPdfColor(options.fillColor)} rg `;
  }

  if (hasStroke) {
    command += `${formatPdfColor(options.strokeColor)} RG `;
  }

  command += `${x.toFixed(2)} ${pdfY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re `;
  command += hasFill && hasStroke ? "B" : hasFill ? "f" : "S";
  command += " Q";
  page.commands.push(command);
}

function drawPdfLine(page, x1, y1, x2, y2, options = {}) {
  const strokeColor = options.strokeColor || PDF_COLORS.line;
  const lineWidth = options.lineWidth || 1;
  const pdfY1 = PDF_PAGE_HEIGHT - y1;
  const pdfY2 = PDF_PAGE_HEIGHT - y2;

  page.commands.push(
    `q ${lineWidth} w ${formatPdfColor(strokeColor)} RG ${x1.toFixed(2)} ${pdfY1.toFixed(2)} m ` +
    `${x2.toFixed(2)} ${pdfY2.toFixed(2)} l S Q`
  );
}

function drawPdfImage(page, x, y, width, height, imageName) {
  const pdfY = PDF_PAGE_HEIGHT - y - height;
  page.commands.push(
    `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${pdfY.toFixed(2)} cm /${imageName} Do Q`
  );
}

function drawPdfCircle(page, centerX, centerY, radius, options = {}) {
  const lineWidth = options.lineWidth || 1;
  const hasFill = Boolean(options.fillColor);
  const hasStroke = Boolean(options.strokeColor);
  const control = radius * 0.5522847498;
  const startY = PDF_PAGE_HEIGHT - centerY;
  const topY = PDF_PAGE_HEIGHT - (centerY - radius);
  const bottomY = PDF_PAGE_HEIGHT - (centerY + radius);
  let command = `q ${lineWidth} w `;

  if (hasFill) {
    command += `${formatPdfColor(options.fillColor)} rg `;
  }

  if (hasStroke) {
    command += `${formatPdfColor(options.strokeColor)} RG `;
  }

  command += [
    `${(centerX + radius).toFixed(2)} ${startY.toFixed(2)} m`,
    `${(centerX + radius).toFixed(2)} ${(startY - control).toFixed(2)} ${(centerX + control).toFixed(2)} ${topY.toFixed(2)} ${centerX.toFixed(2)} ${topY.toFixed(2)} c`,
    `${(centerX - control).toFixed(2)} ${topY.toFixed(2)} ${(centerX - radius).toFixed(2)} ${(startY - control).toFixed(2)} ${(centerX - radius).toFixed(2)} ${startY.toFixed(2)} c`,
    `${(centerX - radius).toFixed(2)} ${(startY + control).toFixed(2)} ${(centerX - control).toFixed(2)} ${bottomY.toFixed(2)} ${centerX.toFixed(2)} ${bottomY.toFixed(2)} c`,
    `${(centerX + control).toFixed(2)} ${bottomY.toFixed(2)} ${(centerX + radius).toFixed(2)} ${(startY + control).toFixed(2)} ${(centerX + radius).toFixed(2)} ${startY.toFixed(2)} c`,
  ].join(" ");

  command += hasFill && hasStroke ? " B Q" : hasFill ? " f Q" : " S Q";
  page.commands.push(command);
}

function drawPdfText(page, x, y, text, options = {}) {
  const size = options.size || 12;
  const color = options.color || PDF_COLORS.text;
  const fontName = options.bold ? "F2" : "F1";
  const maxChars = options.maxChars || Math.max(20, Math.floor((options.width || 420) / (size * 0.55)));
  const lineHeight = options.lineHeight || size + 5;
  let currentY = y;

  wrapText(text, maxChars).forEach((wrappedLine) => {
    const pdfY = PDF_PAGE_HEIGHT - currentY - size;
    page.commands.push(
      `BT /${fontName} ${size} Tf ${formatPdfColor(color)} rg 1 0 0 1 ${x.toFixed(2)} ${pdfY.toFixed(2)} Tm ` +
      `(${escapePdfText(wrappedLine)}) Tj ET`
    );
    currentY += lineHeight;
  });

  return currentY;
}

function drawPdfTextLines(page, x, y, lines, options = {}) {
  const size = options.size || 12;
  const color = options.color || PDF_COLORS.text;
  const fontName = options.bold ? "F2" : "F1";
  const lineHeight = options.lineHeight || size + 5;
  let currentY = y;

  lines.forEach((line) => {
    const pdfY = PDF_PAGE_HEIGHT - currentY - size;
    page.commands.push(
      `BT /${fontName} ${size} Tf ${formatPdfColor(color)} rg 1 0 0 1 ${x.toFixed(2)} ${pdfY.toFixed(2)} Tm ` +
      `(${escapePdfText(line)}) Tj ET`
    );
    currentY += lineHeight;
  });

  return currentY;
}

function drawPdfMetricCard(page, x, y, width, height, label, value, accentColor, subtitle = "") {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.panelStrong,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, x + 14, y + 14, label, { size: 10, color: PDF_COLORS.muted, maxChars: 28, width: width - 28 });
  drawPdfText(page, x + 14, y + 36, value, { size: 20, bold: true, color: accentColor || PDF_COLORS.text, maxChars: 18, width: width - 28 });

  if (subtitle) {
    drawPdfText(page, x + 14, y + 62, subtitle, { size: 9, color: PDF_COLORS.muted, maxChars: 30, width: width - 28 });
  }
}

function drawPdfSectionHeading(page, x, y, title) {
  drawPdfText(page, x, y, title, { size: 15, bold: true, color: PDF_COLORS.text, maxChars: 40, width: 500 });
}

function drawPdfReportHeader(page, generatedAt, pageLabel) {
  drawPdfRect(page, 0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, { fillColor: PDF_COLORS.page });
  drawPdfText(page, 28, 24, "Buckley Park Observations Dashboard", {
    size: 20,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 42,
    width: 340,
  });
  drawPdfText(page, 28, 50, "Class Session Report", {
    size: 12,
    color: PDF_COLORS.muted,
    maxChars: 28,
    width: 180,
  });
  drawPdfText(page, PDF_PAGE_WIDTH - 270, 28, `Generated: ${generatedAt}`, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 42,
    width: 240,
  });
  drawPdfText(page, PDF_PAGE_WIDTH - 120, 50, pageLabel, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 16,
    width: 88,
  });
}

function getPdfNotesLayout(width, height) {
  const textWidth = width - 56;
  const lineHeight = 14;
  const maxChars = Math.max(48, Math.floor(textWidth / 5.8));
  const maxLines = Math.max(1, Math.floor((height - 90) / lineHeight));

  return {
    textWidth,
    lineHeight,
    maxChars,
    maxLines,
  };
}

function paginatePdfNotes(notes, firstSectionWidth, firstSectionHeight, continuationSectionWidth, continuationSectionHeight) {
  const noteText = notes.trim() || "No observation notes recorded.";
  const firstLayout = getPdfNotesLayout(firstSectionWidth, firstSectionHeight);
  const continuationLayout = getPdfNotesLayout(continuationSectionWidth, continuationSectionHeight);
  const wrappedLines = wrapTextPreserveLineBreaks(noteText, firstLayout.maxChars);
  const chunks = [wrappedLines.slice(0, firstLayout.maxLines)];
  let currentIndex = firstLayout.maxLines;

  while (currentIndex < wrappedLines.length) {
    const remainingText = wrappedLines.slice(currentIndex).join("\n");
    const continuationLines = wrapTextPreserveLineBreaks(remainingText, continuationLayout.maxChars);
    chunks.push(continuationLines.slice(0, continuationLayout.maxLines));
    currentIndex += continuationLayout.maxLines;
  }

  return {
    chunks,
    isEmptyState: !notes.trim(),
    lineHeight: firstLayout.lineHeight,
  };
}

function drawPdfNotesSection(page, x, y, width, height, noteLines, options = {}) {
  const title = options.title || "Observation Notes";
  const isEmptyState = Boolean(options.isEmptyState);
  const layout = getPdfNotesLayout(width, height);

  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(page, x + 16, y + 16, title);
  drawPdfRect(page, x + 16, y + 46, width - 32, height - 62, {
    fillColor: PDF_COLORS.white,
    strokeColor: PDF_COLORS.line,
  });

  drawPdfTextLines(page, x + 28, y + 60, noteLines, {
    size: 10,
    color: isEmptyState ? PDF_COLORS.muted : PDF_COLORS.text,
    lineHeight: layout.lineHeight,
  });
}

function drawPdfHeatmap(page, x, y, width, height) {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.panelStrong,
    strokeColor: PDF_COLORS.line,
  });

  drawPdfRect(page, x + 16, y + 16, width - 32, 28, {
    fillColor: PDF_COLORS.slate,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, x + width / 2 - 40, y + 24, "Front of room", {
    size: 11,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 20,
    width: 90,
  });

  const roomX = x + 16;
  const roomY = y + 58;
  const roomWidth = width - 32;
  const roomHeight = height - 100;

  drawPdfRect(page, roomX, roomY, roomWidth, roomHeight, {
    fillColor: PDF_COLORS.white,
    strokeColor: PDF_COLORS.line,
  });

  drawPdfText(page, roomX + 14, roomY + 12, "Classroom activity map", {
    size: 10,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 28,
    width: 180,
  });
  drawPdfText(page, roomX + 14, roomY + 28, "Markers show the exact tap location saved during the lesson.", {
    size: 9,
    color: PDF_COLORS.muted,
    maxChars: 56,
    width: roomWidth - 28,
  });

  const questionOuter = mixPdfColors(PDF_COLORS.blue, PDF_COLORS.white, 0.72);
  const questionMid = mixPdfColors(PDF_COLORS.blue, PDF_COLORS.white, 0.42);
  const disruptionOuter = mixPdfColors(PDF_COLORS.red, PDF_COLORS.white, 0.72);
  const disruptionMid = mixPdfColors(PDF_COLORS.red, PDF_COLORS.white, 0.42);
  const clusters = buildPdfHeatmapClusters(roomX, roomY, roomWidth, roomHeight);

  clusters.forEach((cluster) => {
    const markerColor = cluster.type === "question" ? PDF_COLORS.blue : PDF_COLORS.red;
    const outerColor = cluster.type === "question" ? questionOuter : disruptionOuter;
    const midColor = cluster.type === "question" ? questionMid : disruptionMid;
    const countRadiusBoost = Math.min(8, (cluster.count - 1) * 1.4);
    const outerRadius = 13 + countRadiusBoost;
    const midRadius = 8 + Math.min(5, (cluster.count - 1) * 0.9);

    drawPdfCircle(page, cluster.x, cluster.y, outerRadius, {
      fillColor: outerColor,
    });
    drawPdfCircle(page, cluster.x, cluster.y, midRadius, {
      fillColor: midColor,
    });
    drawPdfCircle(page, cluster.x, cluster.y, 4.2, {
      fillColor: markerColor,
      strokeColor: PDF_COLORS.white,
      lineWidth: 0.9,
    });

    if (cluster.count > 1) {
      const labelWidth = Math.max(14, String(cluster.count).length * 7 + 8);
      const labelX = Math.min(cluster.x + outerRadius - 2, roomX + roomWidth - labelWidth - 4);
      const labelY = Math.max(cluster.y - outerRadius - 8, roomY + 36);

      drawPdfRect(page, labelX, labelY, labelWidth, 14, {
        fillColor: PDF_COLORS.white,
        strokeColor: markerColor,
        lineWidth: 0.9,
      });
      drawPdfText(page, labelX + 4, labelY + 2, String(cluster.count), {
        size: 9,
        bold: true,
        color: markerColor,
        maxChars: 4,
        width: labelWidth - 8,
      });
    }
  });

  drawPdfText(page, x + 20, y + height - 28, "Question activity", {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 22,
    width: 130,
  });
  drawPdfCircle(page, x + 26, y + height - 8, 6, { fillColor: PDF_COLORS.blue });
  drawPdfText(page, x + 170, y + height - 28, "Disruption activity", {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 24,
    width: 140,
  });
  drawPdfCircle(page, x + 176, y + height - 8, 6, { fillColor: PDF_COLORS.red });
}

function getTimelineData(observationMs) {
  const bucketMinutes = getBucketSizeMinutes(observationMs);
  const bucketMs = bucketMinutes * 60000;
  const lastObservationMs = state.events.length === 0 ? 0 : state.events[0].observationMs;
  const bucketCount = Math.max(1, Math.ceil(Math.max(observationMs, lastObservationMs) / bucketMs));
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: index * bucketMs,
    end: (index + 1) * bucketMs,
    question: 0,
    disruption: 0,
  }));

  state.events.forEach((event) => {
    const bucketIndex = clamp(Math.floor(event.observationMs / bucketMs), 0, bucketCount - 1);
    buckets[bucketIndex][event.type] += 1;
  });

  return { bucketMinutes, buckets };
}

function drawPdfTimeBreakdownChart(page, x, y, width, height, observationMs, directMs) {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.white,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, x + 14, y + 14, "Lesson Time Breakdown", {
    size: 13,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 32,
    width: width - 28,
  });
  drawPdfText(page, x + 14, y + 34, "Compare the observed lesson time with the portion spent in direct instruction.", {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 62,
    width: width - 28,
    lineHeight: 13,
  });

  const chartY = y + 78;
  const barWidth = width - 28;
  const barX = x + 14;
  const otherMs = Math.max(0, observationMs - directMs);
  const directShare = observationMs === 0 ? 0 : directMs / observationMs;
  const directWidth = barWidth * directShare;
  const metricY = chartY + 32;
  const metricGap = 10;
  const metricWidth = (width - 28 - metricGap) / 2;

  drawPdfRect(page, barX, chartY, barWidth, 18, {
    fillColor: PDF_COLORS.slate,
  });

  if (directWidth > 0) {
    drawPdfRect(page, barX, chartY, directWidth, 18, {
      fillColor: PDF_COLORS.green,
    });
  }

  drawPdfText(page, barX, chartY + 30, `Observed lesson: ${formatDuration(observationMs)}`, {
    size: 11,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 40,
    width: width - 28,
  });

  drawPdfRect(page, barX, metricY, metricWidth, 34, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, barX + 10, metricY + 7, "Direct instruction", {
    size: 9,
    color: PDF_COLORS.muted,
    maxChars: 24,
    width: metricWidth - 20,
  });
  drawPdfText(page, barX + 10, metricY + 19, `${formatMinutes(directMs)} (${Math.round(directShare * 100)}%)`, {
    size: 10,
    bold: true,
    color: PDF_COLORS.green,
    maxChars: 28,
    width: metricWidth - 20,
  });

  drawPdfRect(page, barX + metricWidth + metricGap, metricY, metricWidth, 34, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, barX + metricWidth + metricGap + 10, metricY + 7, "Other observation time", {
    size: 9,
    color: PDF_COLORS.muted,
    maxChars: 26,
    width: metricWidth - 20,
  });
  drawPdfText(page, barX + metricWidth + metricGap + 10, metricY + 19, `${formatMinutes(otherMs)} (${Math.round((1 - directShare) * 100)}%)`, {
    size: 10,
    bold: true,
    color: PDF_COLORS.darkSlate,
    maxChars: 30,
    width: metricWidth - 20,
  });
}

function drawPdfTimelineChart(page, x, y, width, height, observationMs) {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.white,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, x + 14, y + 14, "Questions and Disruptions Over Time", {
    size: 13,
    bold: true,
    color: PDF_COLORS.text,
    maxChars: 42,
    width: width - 28,
  });
  const timelineData = getTimelineData(observationMs);
  const maxValue = Math.max(
    1,
    ...timelineData.buckets.flatMap((bucket) => [bucket.question, bucket.disruption])
  );
  const chartLeft = x + 42;
  const chartTop = y + 56;
  const chartWidth = width - 62;
  const chartHeight = height - 104;
  const groupWidth = chartWidth / timelineData.buckets.length;
  const barWidth = Math.min(14, Math.max(8, groupWidth * 0.28));

  for (let index = 0; index <= 4; index += 1) {
    const lineY = chartTop + (chartHeight / 4) * index;
    drawPdfLine(page, chartLeft, lineY, chartLeft + chartWidth, lineY, {
      strokeColor: PDF_COLORS.line,
      lineWidth: 0.7,
    });
    if (index < 4) {
      const value = Math.round((maxValue / 4) * (4 - index));
      drawPdfText(page, x + 8, lineY - 6, String(value), {
        size: 9,
        color: PDF_COLORS.muted,
        maxChars: 4,
        width: 24,
      });
    }
  }

  timelineData.buckets.forEach((bucket, index) => {
    const centerX = chartLeft + groupWidth * index + groupWidth / 2;
    const questionHeight = (bucket.question / maxValue) * chartHeight;
    const disruptionHeight = (bucket.disruption / maxValue) * chartHeight;
    const label = `${Math.floor(bucket.start / 60000)}-${Math.floor(bucket.end / 60000)}`;

    if (questionHeight > 0) {
      drawPdfRect(page, centerX - barWidth - 3, chartTop + chartHeight - questionHeight, barWidth, questionHeight, {
        fillColor: PDF_COLORS.blue,
      });
    }

    if (disruptionHeight > 0) {
      drawPdfRect(page, centerX + 3, chartTop + chartHeight - disruptionHeight, barWidth, disruptionHeight, {
        fillColor: PDF_COLORS.red,
      });
    }

    drawPdfText(page, centerX - 12, chartTop + chartHeight + 10, label, {
      size: 8,
      color: PDF_COLORS.muted,
      maxChars: 7,
      width: 32,
    });
  });

  drawPdfText(page, x + 14, y + height - 28, `Bucket size: ${timelineData.bucketMinutes} min`, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 24,
    width: 110,
  });
  drawPdfRect(page, x + width - 120, y + height - 24, 10, 10, { fillColor: PDF_COLORS.blue });
  drawPdfText(page, x + width - 104, y + height - 28, "Questions", {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 14,
    width: 52,
  });
  drawPdfRect(page, x + width - 48, y + height - 24, 10, 10, { fillColor: PDF_COLORS.red });
  drawPdfText(page, x + width - 32, y + height - 28, "Disruptions", {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 16,
    width: 70,
  });
}

async function captureHeatmapSnapshot() {
  const liveHeatmap = document.querySelector(".room-frame");

  if (!liveHeatmap) {
    return null;
  }

  const heatmapPrintCss = `
    .room-frame {
      background: #ffffff !important;
      border: 1px solid #d7e1eb !important;
      box-shadow: none !important;
      color: #1c2835 !important;
    }

    .room-front {
      background: linear-gradient(135deg, rgba(96, 165, 250, 0.16), rgba(245, 158, 11, 0.16)) !important;
      border: 1px dashed #cbd7e3 !important;
      color: #1c2835 !important;
    }

    .tap-hint,
    .legend,
    .legend span {
      color: #41505f !important;
    }

    .heatmap-surface {
      background:
        radial-gradient(circle at top left, rgba(96, 165, 250, 0.10), transparent 28%),
        radial-gradient(circle at bottom right, rgba(248, 113, 113, 0.10), transparent 28%),
        linear-gradient(180deg, #ffffff, #f8fbfe) !important;
      border: 1px solid #d7e1eb !important;
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.7),
        inset 0 -16px 20px rgba(201, 214, 227, 0.18) !important;
    }

    .heatmap-surface::before {
      background:
        linear-gradient(90deg, rgba(31, 41, 51, 0.03), transparent 18%, transparent 82%, rgba(31, 41, 51, 0.03)),
        radial-gradient(circle at center, rgba(96, 165, 250, 0.05), transparent 52%) !important;
    }

    .desk {
      border: 1px solid #d3dde8 !important;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(235, 241, 247, 0.9)) !important;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.75) !important;
    }

    .heat-glow {
      opacity: 0.6 !important;
    }

    .heat-glow.question {
      background: radial-gradient(circle, rgba(96, 165, 250, 0.55), rgba(96, 165, 250, 0.04) 72%) !important;
    }

    .heat-glow.disruption {
      background: radial-gradient(circle, rgba(248, 113, 113, 0.54), rgba(248, 113, 113, 0.04) 72%) !important;
    }

    .event-marker {
      border: 2px solid #ffffff !important;
      box-shadow: 0 6px 10px rgba(28, 40, 53, 0.18) !important;
    }
  `;

  const canvas = await captureElementAsCanvas(liveHeatmap, heatmapPrintCss);
  return {
    name: "ImHeatmap",
    bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.95)),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
  };
}

function drawPdfEventLogSection(page, x, y, width, height) {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(page, x + 16, y + 16, "Event Log");

  const headerY = y + 48;
  drawPdfRect(page, x + 16, headerY, width - 32, 26, {
    fillColor: PDF_COLORS.slate,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfText(page, x + 24, headerY + 8, "Time", { size: 9, bold: true, color: PDF_COLORS.text, maxChars: 10, width: 50 });
  drawPdfText(page, x + 88, headerY + 8, "Tap Position", { size: 9, bold: true, color: PDF_COLORS.text, maxChars: 16, width: 78 });
  drawPdfText(page, x + 190, headerY + 8, "Event", { size: 9, bold: true, color: PDF_COLORS.text, maxChars: 10, width: 42 });
  drawPdfText(page, x + 250, headerY + 8, "Clock", { size: 9, bold: true, color: PDF_COLORS.text, maxChars: 10, width: 48 });
  drawPdfText(page, x + width - 78, headerY + 8, "Direct", { size: 9, bold: true, color: PDF_COLORS.text, maxChars: 10, width: 42 });

  const maxRows = Math.max(1, Math.floor((height - 94) / 18));
  const displayedEvents = state.events.slice(0, maxRows);
  let rowY = headerY + 34;

  if (displayedEvents.length === 0) {
    drawPdfText(page, x + 24, rowY + 4, "No events recorded.", {
      size: 10,
      color: PDF_COLORS.muted,
      maxChars: 24,
      width: width - 48,
    });
  } else {
    displayedEvents.forEach((event) => {
      drawPdfLine(page, x + 16, rowY - 4, x + width - 16, rowY - 4, {
        strokeColor: PDF_COLORS.line,
        lineWidth: 0.6,
      });

      const timeLabel = new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      drawPdfText(page, x + 24, rowY, timeLabel, { size: 8, color: PDF_COLORS.text, maxChars: 12, width: 56 });
      drawPdfText(page, x + 88, rowY, formatTapPosition(event.point, false), { size: 8, color: PDF_COLORS.text, maxChars: 16, width: 92 });
      drawPdfText(page, x + 190, rowY, TOOL_TYPES[event.type], {
        size: 8,
        bold: true,
        color: event.type === "question" ? PDF_COLORS.blue : PDF_COLORS.red,
        maxChars: 12,
        width: 52,
      });
      drawPdfText(page, x + 250, rowY, formatDuration(event.observationMs), { size: 8, color: PDF_COLORS.text, maxChars: 12, width: 58 });
      drawPdfText(page, x + width - 72, rowY, event.duringDirectInstruction ? "Yes" : "No", {
        size: 8,
        color: event.duringDirectInstruction ? PDF_COLORS.amber : PDF_COLORS.muted,
        maxChars: 8,
        width: 36,
      });
      rowY += 18;
    });
  }

  if (state.events.length > displayedEvents.length) {
    drawPdfText(page, x + 16, y + height - 22, `Showing ${displayedEvents.length} of ${state.events.length} events`, {
      size: 9,
      color: PDF_COLORS.muted,
      maxChars: 40,
      width: width - 32,
    });
  }
}

function drawPdfLiveDashboardSection(page, x, y, width, height, observationMs, directMs, questionPer5, disruptionPer5, directEvents, totalEvents, directShareValue) {
  drawPdfRect(page, x, y, width, height, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(page, x + 16, y + 16, "Live Data Dashboard");

  const cardGap = 12;
  const cardWidth = (width - 32 - cardGap * 2) / 3;
  drawPdfMetricCard(page, x + 16, y + 48, cardWidth, 74, "Questions per 5 min", questionPer5.toFixed(1), PDF_COLORS.blue);
  drawPdfMetricCard(page, x + 16 + cardWidth + cardGap, y + 48, cardWidth, 74, "Disruptions per 5 min", disruptionPer5.toFixed(1), PDF_COLORS.red);
  drawPdfMetricCard(
    page,
    x + 16 + (cardWidth + cardGap) * 2,
    y + 48,
    cardWidth,
    74,
    "Events during direct instruction",
    `${directEvents} / ${totalEvents}`,
    PDF_COLORS.amber,
    `${directShareValue}% of logged events`
  );

  const chartWidth = width - 32;
  const firstChartY = y + 138;
  const firstChartHeight = 156;
  const chartGap = 16;
  const secondChartY = firstChartY + firstChartHeight + chartGap;
  const secondChartHeight = height - (secondChartY - y) - 16;
  drawPdfTimeBreakdownChart(page, x + 16, firstChartY, chartWidth, firstChartHeight, observationMs, directMs);
  drawPdfTimelineChart(page, x + 16, secondChartY, chartWidth, secondChartHeight, observationMs);
}

function getCaptureStylesText() {
  let cssText = "";

  Array.from(document.styleSheets).forEach((styleSheet) => {
    try {
      Array.from(styleSheet.cssRules || []).forEach((rule) => {
        cssText += `${rule.cssText}\n`;
      });
    } catch (error) {
      console.warn("Skipping stylesheet during PDF capture", error);
    }
  });

  cssText += `
    .pdf-capture {
      margin: 0 !important;
      max-width: none !important;
      transform: none !important;
    }

    .pdf-capture .table-wrap {
      max-height: none !important;
      overflow: visible !important;
    }

    .pdf-capture .chart-svg {
      max-height: none !important;
    }
  `;

  return cssText;
}

function prepareCloneForCapture(clone, width) {
  clone.classList.add("pdf-capture");
  clone.style.width = `${width}px`;
  clone.style.maxWidth = "none";
  clone.style.margin = "0";
}

async function captureElementAsCanvas(element, extraCss = "") {
  const sourceRect = element.getBoundingClientRect();
  const fallbackWidth = parseFloat(element.style.width) || element.scrollWidth || 1600;
  const fallbackHeight = parseFloat(element.style.height) || element.scrollHeight || 1132;
  const width = Math.ceil(sourceRect.width || fallbackWidth);
  const clone = element.cloneNode(true);
  prepareCloneForCapture(clone, width);

  const sandbox = document.createElement("div");
  sandbox.style.position = "fixed";
  sandbox.style.left = "-20000px";
  sandbox.style.top = "0";
  sandbox.style.width = `${width}px`;
  sandbox.style.pointerEvents = "none";
  sandbox.style.opacity = "0";

  const style = document.createElement("style");
  style.textContent = `${getCaptureStylesText()}\n${extraCss}`;
  sandbox.appendChild(style);
  sandbox.appendChild(clone);
  document.body.appendChild(sandbox);

  const measuredRect = clone.getBoundingClientRect();
  const height = Math.ceil(
    Math.max(
      measuredRect.height || 0,
      clone.scrollHeight || 0,
      clone.offsetHeight || 0,
      fallbackHeight
    )
  );

  if (width <= 0 || height <= 0) {
    document.body.removeChild(sandbox);
    throw new Error(`Unable to capture element with dimensions ${width}x${height}`);
  }

  const serializedClone = new XMLSerializer().serializeToString(clone);
  document.body.removeChild(sandbox);

  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
          <style>${getCaptureStylesText()}\n${extraCss}</style>
          ${serializedClone}
        </div>
      </foreignObject>
    </svg>
  `;

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  const image = new Image();

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = svgDataUrl;
  });

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function splitCanvasIntoPdfPages(canvas) {
  const margin = 24;
  const maxDrawWidth = PDF_PAGE_WIDTH - margin * 2;
  const maxDrawHeight = PDF_PAGE_HEIGHT - margin * 2;
  const scaleToPage = maxDrawWidth / canvas.width;
  const sourceSliceHeight = Math.max(1, Math.floor(maxDrawHeight / scaleToPage));
  const pages = [];

  for (let offsetY = 0; offsetY < canvas.height; offsetY += sourceSliceHeight) {
    const sliceHeight = Math.min(sourceSliceHeight, canvas.height - offsetY);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeight;
    const sliceContext = sliceCanvas.getContext("2d");
    sliceContext.drawImage(
      canvas,
      0,
      offsetY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight
    );

    const jpegDataUrl = sliceCanvas.toDataURL("image/jpeg", 0.92);
    const drawWidth = maxDrawWidth;
    const drawHeight = (sliceHeight * drawWidth) / canvas.width;

    pages.push({
      bytes: dataUrlToBytes(jpegDataUrl),
      pixelWidth: sliceCanvas.width,
      pixelHeight: sliceCanvas.height,
      drawWidth,
      drawHeight,
      x: margin,
      y: PDF_PAGE_HEIGHT - margin - drawHeight,
    });
  }

  return pages;
}

async function buildSnapshotPdfBlob() {
  const sectionSelectors = [
    ".spotlight-panel",
    ".summary-panel",
    ".heatmap-panel",
    ".log-panel",
    ".analytics-panel",
  ];
  const imagePages = [];

  for (const selector of sectionSelectors) {
    const element = document.querySelector(selector);

    if (!element) {
      continue;
    }

    const canvas = await captureElementAsCanvas(element);
    imagePages.push(...splitCanvasIntoPdfPages(canvas));
  }

  return buildImagePdfBlob(imagePages);
}

function cloneSectionForReport(selector) {
  const source = document.querySelector(selector);

  if (!source) {
    return null;
  }

  const clone = source.cloneNode(true);
  clone.querySelectorAll("button").forEach((button) => button.remove());
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  return clone;
}

async function buildA3ReportElement(now = Date.now()) {
  const report = document.createElement("div");
  report.className = "pdf-report-page";
  report.style.width = "1600px";
  report.style.height = "1132px";

  const header = document.createElement("header");
  header.className = "pdf-report-header";
  header.innerHTML = `
    <div>
      <h1>Buckley Park Observations Dashboard</h1>
      <p>Class Session Report</p>
    </div>
    <div class="pdf-report-meta">
      <span>Generated</span>
      <strong>${new Date(now).toLocaleString()}</strong>
    </div>
  `;
  report.appendChild(header);

  const instruction = cloneSectionForReport(".spotlight-panel");
  const snapshot = cloneSectionForReport(".summary-panel");
  const log = cloneSectionForReport(".log-panel");
  const analytics = cloneSectionForReport(".analytics-panel");

  if (instruction) {
    instruction.classList.add("pdf-slot", "pdf-slot-instruction");
    report.appendChild(instruction);
  }

  if (snapshot) {
    snapshot.classList.add("pdf-slot", "pdf-slot-snapshot");
    report.appendChild(snapshot);
  }

  const liveHeatmap = document.querySelector(".room-frame");
  if (liveHeatmap) {
    const heatmapCanvas = await captureElementAsCanvas(liveHeatmap);
    const heatmapSlot = document.createElement("section");
    heatmapSlot.className = "pdf-slot pdf-slot-heatmap pdf-image-slot";
    heatmapSlot.innerHTML = `<p class="section-label">Classroom Heatmap</p><h2>Final heatmap snapshot</h2>`;

    const heatmapImage = document.createElement("div");
    heatmapImage.className = "pdf-heatmap-image";
    heatmapImage.style.backgroundImage = `url('${heatmapCanvas.toDataURL("image/png")}')`;
    heatmapSlot.appendChild(heatmapImage);
    report.appendChild(heatmapSlot);
  }

  if (log) {
    log.classList.add("pdf-slot", "pdf-slot-log");
    report.appendChild(log);
  }

  if (analytics) {
    analytics.classList.add("pdf-slot", "pdf-slot-analytics");
    report.appendChild(analytics);
  }

  return report;
}

function getA3ReportCss() {
  return `
    .pdf-report-page {
      width: 1600px !important;
      height: 1132px !important;
      padding: 28px !important;
      display: grid !important;
      grid-template-columns: 1.15fr 0.85fr 1.1fr !important;
      grid-template-rows: 84px 180px 360px 1fr !important;
      grid-template-areas:
        "header header header"
        "instruction snapshot snapshot"
        "heatmap log analytics"
        "heatmap log analytics" !important;
      gap: 18px !important;
      background: #ffffff !important;
      color: #1c2835 !important;
      font-family: "Segoe UI", Arial, sans-serif !important;
      box-sizing: border-box !important;
    }

    .pdf-report-page *,
    .pdf-report-page *::before,
    .pdf-report-page *::after {
      box-sizing: border-box !important;
    }

    .pdf-report-header {
      grid-area: header !important;
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      padding: 0 !important;
      color: #1c2835 !important;
    }

    .pdf-report-header h1,
    .pdf-report-header p {
      margin: 0 !important;
      color: #1c2835 !important;
    }

    .pdf-report-header h1 {
      font-size: 28px !important;
      line-height: 1.1 !important;
      font-family: "Aptos Display", Georgia, serif !important;
    }

    .pdf-report-header p {
      margin-top: 6px !important;
      font-size: 15px !important;
      color: #5b6a79 !important;
    }

    .pdf-report-meta {
      text-align: right !important;
      color: #5b6a79 !important;
      font-size: 13px !important;
    }

    .pdf-report-meta strong {
      display: block !important;
      margin-top: 4px !important;
      color: #1c2835 !important;
      font-size: 14px !important;
    }

    .pdf-slot {
      background: #ffffff !important;
      border: 1px solid #d7e1eb !important;
      border-radius: 18px !important;
      padding: 16px !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      color: #1c2835 !important;
      overflow: hidden !important;
    }

    .pdf-slot-instruction { grid-area: instruction !important; }
    .pdf-slot-snapshot { grid-area: snapshot !important; }
    .pdf-slot-heatmap { grid-area: heatmap !important; }
    .pdf-slot-log { grid-area: log !important; }
    .pdf-slot-analytics { grid-area: analytics !important; }

    .pdf-image-slot {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      justify-content: flex-start !important;
      padding: 14px !important;
      background: #ffffff !important;
    }

    .pdf-heatmap-image {
      width: 100% !important;
      height: calc(100% - 44px) !important;
      margin-top: 10px !important;
      background-repeat: no-repeat !important;
      background-position: center !important;
      background-size: contain !important;
      border-radius: 12px !important;
      border: 1px solid #d7e1eb !important;
      background-color: #ffffff !important;
    }

    .pdf-report-page .section-label,
    .pdf-report-page .eyebrow {
      color: #c46d10 !important;
    }

    .pdf-report-page h2,
    .pdf-report-page h3,
    .pdf-report-page p,
    .pdf-report-page span,
    .pdf-report-page th,
    .pdf-report-page td {
      color: #1c2835 !important;
    }

    .pdf-report-page .metric-card,
    .pdf-report-page .summary-card,
    .pdf-report-page .progress-panel,
    .pdf-report-page .chart-card {
      background: #f5f8fc !important;
      border: 1px solid #d9e4ee !important;
      box-shadow: none !important;
    }

    .pdf-report-page .metric-card.highlight {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.10), #f5f8fc) !important;
    }

    .pdf-report-page .metric-card strong,
    .pdf-report-page .summary-card strong,
    .pdf-report-page .analytics-card strong {
      color: #1c2835 !important;
    }

    .pdf-report-page .progress-track {
      background: #dce7f1 !important;
    }

    .pdf-report-page .table-wrap {
      max-height: 255px !important;
      overflow: hidden !important;
    }

    .pdf-report-page table {
      font-size: 11px !important;
    }

    .pdf-report-page th,
    .pdf-report-page td {
      padding: 8px 8px !important;
    }

    .pdf-report-page .analytics-summary {
      gap: 8px !important;
    }

    .pdf-report-page .analytics-grid {
      grid-template-columns: 1fr !important;
      gap: 10px !important;
      margin-top: 10px !important;
    }

    .pdf-report-page .chart-surface {
      min-height: 138px !important;
      margin-top: 8px !important;
    }

    .pdf-report-page .chart-svg {
      max-height: 138px !important;
    }

    .pdf-report-page .chart-empty {
      min-height: 138px !important;
    }
  `;
}

async function buildA3ReportPdfBlob(now = Date.now()) {
  const report = await buildA3ReportElement(now);
  const canvas = await captureElementAsCanvas(report, getA3ReportCss());
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.95);

  return buildImagePdfBlob([
    {
      bytes: dataUrlToBytes(jpegDataUrl),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      drawWidth: PDF_PAGE_WIDTH,
      drawHeight: PDF_PAGE_HEIGHT,
      x: 0,
      y: 0,
    },
  ]);
}

function downloadStructuredPdfReport(now = Date.now()) {
  const observationMs = getObservationElapsed(now);
  const directMs = getDirectElapsed(now);
  const totals = getTotals();
  const { questionPer5, disruptionPer5, directEvents, totalEvents, directShareValue } = getSessionAnalytics(now);
  const generatedAt = new Date(now).toLocaleString();
  const instructionShareValue = observationMs === 0 ? 0 : Math.round((directMs / observationMs) * 100);
  const topY = 78;
  const sectionGap = 20;
  const topHeight = 146;
  const lowerY = topY + topHeight + sectionGap;
  const pageMargin = 28;
  const heatmapHeight = PDF_PAGE_HEIGHT - lowerY - pageMargin;
  const notesSectionY = 78;
  const notesSectionHeight = PDF_PAGE_HEIGHT - notesSectionY - pageMargin;
  const noteSectionWidth = PDF_PAGE_WIDTH - 56;
  const notePages = paginatePdfNotes(
    state.notes,
    noteSectionWidth,
    notesSectionHeight,
    noteSectionWidth,
    notesSectionHeight
  );
  const totalPages = 2 + notePages.chunks.length;
  const pdfPages = Array.from({ length: totalPages }, () => createPdfPage());
  const pageOne = pdfPages[0];
  const pageTwo = pdfPages[1];

  pdfPages.forEach((page, index) => {
    drawPdfReportHeader(page, generatedAt, `Page ${index + 1} of ${totalPages}`);
  });

  const instructionX = 28;
  const instructionWidth = 560;
  const snapshotX = instructionX + instructionWidth + sectionGap;
  const snapshotWidth = PDF_PAGE_WIDTH - snapshotX - 28;

  drawPdfRect(pageOne, instructionX, topY, instructionWidth, topHeight, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(pageOne, instructionX + 16, topY + 16, "Instruction Timing");
  drawPdfMetricCard(pageOne, instructionX + 16, topY + 46, 164, 72, "Observation Time", formatDuration(observationMs), PDF_COLORS.text);
  drawPdfMetricCard(pageOne, instructionX + 196, topY + 46, 164, 72, "Direct Instruction", formatDuration(directMs), PDF_COLORS.green);
  drawPdfMetricCard(pageOne, instructionX + 376, topY + 46, 168, 72, "Instruction Share", `${instructionShareValue}%`, PDF_COLORS.amber);
  drawPdfText(pageOne, instructionX + 16, topY + 128, instructionStatus.textContent, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 56,
    width: 280,
  });
  drawPdfText(pageOne, instructionX + 330, topY + 128, segmentCount.textContent, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 36,
    width: 220,
  });

  drawPdfRect(pageOne, snapshotX, topY, snapshotWidth, topHeight, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(pageOne, snapshotX + 16, topY + 16, "Lesson Snapshot");
  drawPdfMetricCard(pageOne, snapshotX + 16, topY + 46, (snapshotWidth - 48) / 2, 72, "Questions logged", String(totals.question), PDF_COLORS.blue);
  drawPdfMetricCard(pageOne, snapshotX + 32 + (snapshotWidth - 48) / 2, topY + 46, (snapshotWidth - 48) / 2, 72, "Disruptions logged", String(totals.disruption), PDF_COLORS.red);
  drawPdfText(pageOne, snapshotX + 16, topY + 128, `Total logged events: ${state.events.length}`, {
    size: 10,
    color: PDF_COLORS.muted,
    maxChars: 24,
    width: 180,
  });

  const heatmapWidth = PDF_PAGE_WIDTH - 56;
  drawPdfRect(pageOne, instructionX, lowerY, heatmapWidth, heatmapHeight, {
    fillColor: PDF_COLORS.panel,
    strokeColor: PDF_COLORS.line,
  });
  drawPdfSectionHeading(pageOne, instructionX + 16, lowerY + 16, "Classroom Heatmap");
  const heatmapBoxX = instructionX + 16;
  const heatmapBoxY = lowerY + 46;
  const heatmapBoxWidth = heatmapWidth - 32;
  const heatmapBoxHeight = heatmapHeight - 62;
  drawPdfHeatmap(pageOne, heatmapBoxX, heatmapBoxY, heatmapBoxWidth, heatmapBoxHeight);

  const liveX = 28;
  const liveY = 78;
  const liveWidth = PDF_PAGE_WIDTH - 56;
  const liveHeight = PDF_PAGE_HEIGHT - liveY - 28;
  drawPdfLiveDashboardSection(
    pageTwo,
    liveX,
    liveY,
    liveWidth,
    liveHeight,
    observationMs,
    directMs,
    questionPer5,
    disruptionPer5,
    directEvents,
    totalEvents,
    directShareValue
  );

  notePages.chunks.forEach((noteChunk, index) => {
    const continuationPage = pdfPages[index + 2];
    drawPdfNotesSection(
      continuationPage,
      28,
      notesSectionY,
      noteSectionWidth,
      notesSectionHeight,
      noteChunk,
      {
        title: index === 0 ? "Observation Notes" : "Observation Notes (continued)",
        isEmptyState: notePages.isEmptyState,
      }
    );
  });

  const pdfBlob = buildPdfBlob(
    pdfPages.map((page) => page.commands.join("\n")),
    pdfPages.map(() => [])
  );
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  const timestamp = new Date(now).toISOString().slice(0, 19).replaceAll(":", "-");

  link.href = pdfUrl;
  link.download = `buckley-park-observation-report-${timestamp}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(pdfUrl);
}

async function downloadPdfReport(now = Date.now()) {
  downloadStructuredPdfReport(now);
}

function getObservationElapsed(now = Date.now()) {
  if (!state.observationRunning || !state.observationStartedAt) {
    return state.observationElapsedMs;
  }

  return state.observationElapsedMs + (now - state.observationStartedAt);
}

function getDirectElapsed(now = Date.now()) {
  if (!state.directRunning || !state.directStartedAt) {
    return state.directElapsedMs;
  }

  return state.directElapsedMs + (now - state.directStartedAt);
}

function pauseObservation(now = Date.now()) {
  state.observationElapsedMs = getObservationElapsed(now);
  state.observationRunning = false;
  state.observationStartedAt = null;
}

function pauseDirectInstruction(now = Date.now()) {
  state.directElapsedMs = getDirectElapsed(now);
  state.directRunning = false;
  state.directStartedAt = null;
}

function toggleObservation() {
  const now = Date.now();

  if (state.observationRunning) {
    pauseObservation(now);

    if (state.directRunning) {
      pauseDirectInstruction(now);
    }
  } else {
    clearEndedSessionFlag();
    state.observationRunning = true;
    state.observationStartedAt = now;
  }

  saveState();
  render();
}

function toggleDirectInstruction() {
  const now = Date.now();

  if (!state.observationRunning) {
    clearEndedSessionFlag();
    state.observationRunning = true;
    state.observationStartedAt = now;
  }

  if (state.directRunning) {
    pauseDirectInstruction(now);
  } else {
    clearEndedSessionFlag();
    state.directRunning = true;
    state.directStartedAt = now;
    state.directSegments += 1;
  }

  saveState();
  render();
}

function getTotals() {
  return state.events.reduce(
    (totals, event) => {
      totals[event.type] += 1;
      return totals;
    },
    { question: 0, disruption: 0 }
  );
}

function recordEvent(point) {
  const now = Date.now();
  clearEndedSessionFlag();

  if (!state.observationRunning && getObservationElapsed(now) === 0) {
    state.observationRunning = true;
    state.observationStartedAt = now;
  }

  const observationMs = getObservationElapsed(now);
  state.events.unshift({
    id: `${now}-${Math.random().toString(16).slice(2, 8)}`,
    type: state.selectedTool,
    location: formatTapPosition(point),
    timestamp: new Date(now).toISOString(),
    observationMs,
    duringDirectInstruction: state.directRunning,
    point,
  });

  saveState();
  render();
}

function undoLastEvent() {
  const lastEvent = state.events.shift();

  if (!lastEvent) {
    return;
  }

  clearEndedSessionFlag();
  saveState();
  render();
}

function resetSession() {
  const shouldReset = window.confirm("Reset the observation timers and all recorded events?");

  if (!shouldReset) {
    return;
  }

  state = defaultState();
  saveState();
  render();
}

function buildHeatmap() {
  heatmapOverlay.innerHTML = "";

  state.events
    .slice(0, 80)
    .reverse()
    .forEach((event) => {
      if (!event.point) {
        return;
      }

      const glow = document.createElement("span");
      glow.className = `heat-glow ${event.type}`;
      glow.style.left = `${event.point.xPercent}%`;
      glow.style.top = `${event.point.yPercent}%`;
      heatmapOverlay.appendChild(glow);
    });

  state.events
    .slice(0, 80)
    .reverse()
    .forEach((event) => {
      if (!event.point) {
        return;
      }

      const marker = document.createElement("span");
      marker.className = `event-marker ${event.type}`;
      marker.style.left = `${event.point.xPercent}%`;
      marker.style.top = `${event.point.yPercent}%`;
      heatmapOverlay.appendChild(marker);
    });
}

function handleSurfaceInteraction(clientX, clientY) {
  const bounds = heatmapSurface.getBoundingClientRect();
  const xPercent = clamp(((clientX - bounds.left) / bounds.width) * 100, 0, 100);
  const yPercent = clamp(((clientY - bounds.top) / bounds.height) * 100, 0, 100);
  recordEvent({ xPercent, yPercent });
}

async function endClassSession() {
  const now = Date.now();

  if (state.directRunning) {
    pauseDirectInstruction(now);
  }

  if (state.observationRunning) {
    pauseObservation(now);
  }

  state.sessionEndedAt = now;
  saveState();
  render(now);
}

async function handlePdfDownload() {
  if (!hasEndedSession()) {
    return;
  }

  const reportTime = state.sessionEndedAt || Date.now();
  pdfDownloadInProgress = true;

  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  try {
    render(reportTime);
    await downloadPdfReport(reportTime);
  } finally {
    pdfDownloadInProgress = false;
    render(reportTime);
  }
}

function getBucketSizeMinutes(observationMs) {
  return 10;
}

function buildTimeBreakdownChart(observationMs, directMs) {
  if (observationMs <= 0) {
    return `
      <p class="chart-empty">Start the observation to build the lesson time comparison.</p>
    `;
  }

  const otherMs = Math.max(0, observationMs - directMs);
  const directShare = observationMs === 0 ? 0 : directMs / observationMs;
  const otherShare = 1 - directShare;
  const barWidth = 420;
  const directWidth = Math.max(0, Math.round(barWidth * directShare));
  const otherWidth = Math.max(0, barWidth - directWidth);

  return `
    <svg class="chart-svg" viewBox="0 0 520 260" role="img" aria-label="Lesson time breakdown">
      <rect x="0" y="0" width="520" height="260" rx="24" fill="rgba(17,35,47,0.82)"></rect>
      <text x="34" y="44" font-size="15" font-weight="700" fill="#9fb0c1">Observed lesson</text>
      <text x="34" y="74" font-size="30" font-weight="800" fill="#f3f7fb">${formatDuration(observationMs)}</text>

      <rect x="34" y="102" width="${barWidth}" height="34" rx="17" fill="rgba(255, 255, 255, 0.08)"></rect>
      <rect x="34" y="102" width="${directWidth}" height="34" rx="17" fill="#22c55e"></rect>
      <rect x="${34 + directWidth}" y="102" width="${otherWidth}" height="34" rx="17" fill="#2d4a5b"></rect>

      <circle cx="42" cy="166" r="6" fill="#22c55e"></circle>
      <text x="56" y="171" font-size="14" fill="#9fb0c1">Direct instruction</text>
      <text x="218" y="171" font-size="14" font-weight="700" fill="#f3f7fb">${formatMinutes(directMs)} (${Math.round(directShare * 100)}%)</text>

      <circle cx="42" cy="196" r="6" fill="#2d4a5b"></circle>
      <text x="56" y="201" font-size="14" fill="#9fb0c1">Other observation time</text>
      <text x="218" y="201" font-size="14" font-weight="700" fill="#f3f7fb">${formatMinutes(otherMs)} (${Math.round(otherShare * 100)}%)</text>

      <text x="34" y="234" font-size="13" fill="#9fb0c1">The bar updates continuously, so you can compare direct instruction against the rest of the lesson at a glance.</text>
    </svg>
  `;
}

function buildTimelineChart(observationMs) {
  if (state.events.length === 0) {
    return `
      <p class="chart-empty">Log questions or disruptions to build the live event timeline.</p>
    `;
  }

  const timelineData = getTimelineData(observationMs);

  const maxValue = Math.max(
    1,
    ...timelineData.buckets.flatMap((bucket) => [bucket.question, bucket.disruption])
  );
  const innerHeight = 140;
  const chartTop = 44;
  const chartLeft = 52;
  const chartWidth = 420;
  const groupWidth = chartWidth / timelineData.buckets.length;
  const barWidth = Math.min(20, Math.max(10, groupWidth * 0.28));

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const value = Math.round((maxValue / 4) * (4 - index));
    const y = chartTop + (innerHeight / 4) * index;
    return `
      <line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="rgba(159, 176, 193, 0.18)" stroke-width="1"></line>
      <text x="${chartLeft - 12}" y="${y + 4}" text-anchor="end" font-size="12" fill="#9fb0c1">${value}</text>
    `;
  }).join("");

  const bars = timelineData.buckets.map((bucket, index) => {
    const centerX = chartLeft + groupWidth * index + groupWidth / 2;
    const questionHeight = (bucket.question / maxValue) * innerHeight;
    const disruptionHeight = (bucket.disruption / maxValue) * innerHeight;
    const questionX = centerX - barWidth - 4;
    const disruptionX = centerX + 4;
    const questionY = chartTop + innerHeight - questionHeight;
    const disruptionY = chartTop + innerHeight - disruptionHeight;
    const startMin = Math.floor(bucket.start / 60000);
    const endMin = Math.floor(bucket.end / 60000);
    const label = `${startMin}-${endMin}`;

    return `
      <rect x="${questionX}" y="${questionY}" width="${barWidth}" height="${Math.max(questionHeight, 1)}" rx="6" fill="#60a5fa"></rect>
      <rect x="${disruptionX}" y="${disruptionY}" width="${barWidth}" height="${Math.max(disruptionHeight, 1)}" rx="6" fill="#f87171"></rect>
      <text x="${centerX}" y="${chartTop + innerHeight + 24}" text-anchor="middle" font-size="11" fill="#9fb0c1">${label}</text>
    `;
  }).join("");

  return `
    <svg class="chart-svg" viewBox="0 0 520 260" role="img" aria-label="Questions and disruptions over time">
      <rect x="0" y="0" width="520" height="260" rx="24" fill="rgba(17,35,47,0.82)"></rect>
      <text x="34" y="28" font-size="14" font-weight="700" fill="#9fb0c1">Bucket size: ${timelineData.bucketMinutes} min</text>
      ${gridLines}
      ${bars}
      <text x="${chartLeft + chartWidth / 2}" y="236" text-anchor="middle" font-size="13" fill="#9fb0c1">Observation minutes</text>
      <circle cx="338" cy="28" r="6" fill="#60a5fa"></circle>
      <text x="352" y="33" font-size="13" fill="#9fb0c1">Questions</text>
      <circle cx="432" cy="28" r="6" fill="#f87171"></circle>
      <text x="446" y="33" font-size="13" fill="#9fb0c1">Disruptions</text>
    </svg>
  `;
}

function renderAnalytics(now = Date.now()) {
  const observationMs = getObservationElapsed(now);
  const directMs = getDirectElapsed(now);
  const sessionEnded = hasEndedSession();

  if (sessionEnded) {
    const { questionPer5, disruptionPer5, directEvents, totalEvents } = getSessionAnalytics(now);
    questionRate.textContent = questionPer5.toFixed(1);
    disruptionRate.textContent = disruptionPer5.toFixed(1);
    directEventShare.textContent = `${directEvents} / ${totalEvents}`;
  } else {
    questionRate.textContent = "--";
    disruptionRate.textContent = "--";
    directEventShare.textContent = "--";
  }

  timeBreakdownChart.innerHTML = buildTimeBreakdownChart(observationMs, directMs);
  timelineChart.innerHTML = buildTimelineChart(observationMs);
}

function renderSummary(now = Date.now()) {
  const observationMs = getObservationElapsed(now);
  const directMs = getDirectElapsed(now);
  const totals = getTotals();
  const share = observationMs === 0 ? 0 : Math.round((directMs / observationMs) * 100);
  const sessionEnded = hasEndedSession();

  observationTime.textContent = formatDuration(observationMs);
  directInstructionTime.textContent = formatDuration(directMs);
  instructionShare.textContent = `${share}%`;
  questionTotal.textContent = totals.question;
  disruptionTotal.textContent = totals.disruption;
  instructionProgress.style.width = `${Math.min(share, 100)}%`;
  segmentCount.textContent = `${state.directSegments} instruction segment${state.directSegments === 1 ? "" : "s"} recorded`;
  instructionStatus.textContent = state.directRunning
    ? "Direct instruction is running right now."
    : "Direct instruction is currently paused.";

  observationToggle.textContent = state.observationRunning ? "Pause Observation" : "Start Observation";
  directInstructionToggle.textContent = state.directRunning ? "Pause Direct Instruction" : "Start Direct Instruction";
  directInstructionToggle.classList.toggle("running", state.directRunning);
  endSessionDownloadButton.textContent = sessionEnded ? "Session Ended" : "End Class Session";
  endSessionDownloadButton.disabled = sessionEnded;

  if (downloadPdfReportButton) {
    downloadPdfReportButton.hidden = !sessionEnded;
    downloadPdfReportButton.disabled = !sessionEnded || pdfDownloadInProgress;
    downloadPdfReportButton.textContent = pdfDownloadInProgress ? "Preparing PDF..." : "Download PDF Report";
  }
}

function renderToolState() {
  toolButtons.forEach((button) => {
    const isActive = button.dataset.tool === state.selectedTool;
    button.classList.toggle("active", isActive);
  });

  tapHint.textContent = `Tap anywhere in the room to log a ${TOOL_TYPES[state.selectedTool].toLowerCase()}.`;
  heatmapSurface.setAttribute("aria-label", `Tap anywhere in the classroom to log a ${TOOL_TYPES[state.selectedTool].toLowerCase()}`);
}

function renderLog() {
  if (state.events.length === 0) {
    eventLogBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="3">No events recorded yet. Choose an event type and click the classroom map.</td>
      </tr>
    `;
    return;
  }

  eventLogBody.innerHTML = state.events
    .map((event) => {
      const timeLabel = new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      return `
        <tr>
          <td>${timeLabel}</td>
          <td><span class="event-pill ${event.type}">${TOOL_TYPES[event.type]}</span></td>
          <td>${formatDuration(event.observationMs)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderNotes() {
  if (!observationNotes) {
    return;
  }

  if (observationNotes.value !== state.notes) {
    observationNotes.value = state.notes;
  }
}

function render(now = Date.now()) {
  renderSummary(now);
  renderToolState();
  buildHeatmap();
  renderLog();
  renderNotes();
  renderAnalytics(now);
  undoLastEventButton.disabled = state.events.length === 0;
}

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedTool = button.dataset.tool;
    saveState();
    render();
  });
});

heatmapSurface.addEventListener("pointerdown", (event) => {
  handleSurfaceInteraction(event.clientX, event.clientY);
});

heatmapSurface.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  const bounds = heatmapSurface.getBoundingClientRect();
  handleSurfaceInteraction(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
});

observationToggle.addEventListener("click", toggleObservation);
directInstructionToggle.addEventListener("click", toggleDirectInstruction);
endSessionDownloadButton.addEventListener("click", endClassSession);
downloadPdfReportButton.addEventListener("click", handlePdfDownload);
resetSessionButton.addEventListener("click", resetSession);
undoLastEventButton.addEventListener("click", undoLastEvent);

if (observationNotes) {
  observationNotes.addEventListener("input", () => {
    state.notes = observationNotes.value;
    saveState();
  });
}

setInterval(() => {
  render();
}, 500);

render();
