import { jsPDF } from "jspdf";
import type { ReportsSummary } from "../types";

const MARGIN_X = 14;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function addFooter(doc: jsPDF, pageLabel: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 137, 125);
    doc.text(pageLabel, MARGIN_X, 290);
    doc.text(`Page ${i} / ${pageCount}`, PAGE_WIDTH - MARGIN_X, 290, { align: "right" });
  }
}

export function exportReportsPdf(summary: ReportsSummary, buildingLabel: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const generatedAt = new Date();
  let y = 20;

  doc.setFontSize(18);
  doc.setTextColor(35, 35, 31);
  doc.text("DynamIQ — Building Report", MARGIN_X, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(100, 97, 90);
  doc.text(`${buildingLabel} · generated ${generatedAt.toLocaleString()} · last ${summary.windowDays} days`, MARGIN_X, y);
  y += 12;

  const stats: [string, string][] = [
    ["Predicted energy", `${summary.totalPredictedKwh.toFixed(1)} kWh`],
    ["Predicted CO2", `${(summary.totalPredictedGco2 / 1000).toFixed(1)} kg`],
    ["Predicted cost", `${summary.totalPredictedCostCurrency.toFixed(0)} DZD (flat tariff ${summary.tariffCurrencyPerKwh} DZD/kWh)`],
    ["Avg comfort deviation", summary.avgComfortDeviationC !== null ? `${summary.avgComfortDeviationC.toFixed(1)}°C from comfort band midpoint` : "no instrumented rooms with readings"],
  ];
  doc.setFontSize(13);
  doc.setTextColor(35, 35, 31);
  doc.text("Summary", MARGIN_X, y);
  y += 7;
  doc.setFontSize(10.5);
  for (const [label, value] of stats) {
    doc.setTextColor(100, 97, 90);
    doc.text(label, MARGIN_X, y);
    doc.setTextColor(35, 35, 31);
    doc.text(value, MARGIN_X + 55, y);
    y += 6.5;
  }
  y += 4;

  doc.setFontSize(8.5);
  doc.setTextColor(140, 137, 125);
  const note = doc.splitTextToSize(
    "These are Agent 2's own predicted totals from real mpc_schedules rows. No reactive-baseline counterfactual is stored anywhere in this system, so an \"energy saved\" figure is not reported here — that number does not exist.",
    CONTENT_WIDTH
  );
  doc.text(note, MARGIN_X, y);
  y += note.length * 4 + 8;

  doc.setDrawColor(232, 231, 227);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 10;

  doc.setFontSize(13);
  doc.setTextColor(35, 35, 31);
  doc.text("Predicted energy & carbon by day", MARGIN_X, y);
  y += 8;

  doc.setFontSize(9.5);
  doc.setTextColor(100, 97, 90);
  const dailyColX = [MARGIN_X, MARGIN_X + 45, MARGIN_X + 85];
  doc.text("Date", dailyColX[0], y);
  doc.text("kWh", dailyColX[1], y);
  doc.text("gCO2", dailyColX[2], y);
  y += 2;
  doc.setDrawColor(232, 231, 227);
  doc.line(MARGIN_X, y, MARGIN_X + 110, y);
  y += 5;
  doc.setTextColor(35, 35, 31);
  if (summary.daily.length === 0) {
    doc.setTextColor(140, 137, 125);
    doc.text("No mpc_schedules rows in this window.", dailyColX[0], y);
    y += 6.5;
  } else {
    for (const d of summary.daily) {
      doc.text(d.date, dailyColX[0], y);
      doc.text(d.kwh.toFixed(2), dailyColX[1], y);
      doc.text(d.gco2.toFixed(0), dailyColX[2], y);
      y += 6.5;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    }
  }
  y += 6;

  doc.setDrawColor(232, 231, 227);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 10;

  doc.setFontSize(13);
  doc.setTextColor(35, 35, 31);
  doc.text("Comfort tracking", MARGIN_X, y);
  y += 8;

  doc.setFontSize(9.5);
  doc.setTextColor(100, 97, 90);
  const cColX = [MARGIN_X, MARGIN_X + 60, MARGIN_X + 90, MARGIN_X + 120];
  doc.text("Room", cColX[0], y);
  doc.text("Latest temp", cColX[1], y);
  doc.text("Deviation", cColX[2], y);
  doc.text("Reading at", cColX[3], y);
  y += 2;
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 5;
  doc.setTextColor(35, 35, 31);
  if (summary.comfortLeaderboard.length === 0) {
    doc.setTextColor(140, 137, 125);
    doc.text("No instrumented rooms with sensor readings yet.", cColX[0], y);
    y += 6.5;
  } else {
    for (const r of summary.comfortLeaderboard) {
      doc.text(`${r.roomLabel} (Floor ${r.floorLevel})`, cColX[0], y);
      doc.text(`${r.latestTempC.toFixed(1)}°C`, cColX[1], y);
      doc.text(`${r.deviationC.toFixed(1)}°C`, cColX[2], y);
      doc.text(new Date(r.readingAt).toLocaleString(), cColX[3], y);
      y += 6.5;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    }
  }

  addFooter(doc, `DynamIQ — ${buildingLabel}`);

  const filename = `dynamiq-report-${buildingLabel.toLowerCase().replace(/\s+/g, "-")}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
