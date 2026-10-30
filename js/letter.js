// Builds the attendance letter PDF. Shared by the page and the node test.
// buildLetter(jsPDF, autoTable, { letterhead, to, subject, greeting, body, note, rows })
// rows: [[name, branch, roll, sap, division, year], ...], with an optional 7th Timing column.
function buildLetter(jsPDF, autoTable, o) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, L = 18, R = 18, TW = W - L - R;
  const LH_W = 190, LH_H = LH_W * 464 / 2285;
  doc.addImage(o.letterhead, "JPEG", (W - LH_W) / 2, 6, LH_W, LH_H);

  let y = 6 + LH_H + 9;
  const line = 5.2;
  const para = (text, style, gapAfter) => {
    doc.setFont("times", style);
    doc.setFontSize(11.5);
    const lines = doc.splitTextToSize(text, TW);
    doc.text(lines, L, y, { baseline: "top" });
    y += lines.length * line + (gapAfter || 0);
  };

  if (o.to.trim()) para(o.to.trim(), "normal", 4);
  if (o.subject.trim()) para("SUBJECT: " + o.subject.trim(), "bold", 4);
  if (o.greeting.trim()) para(o.greeting.trim(), "normal", 0.5);
  if (o.body.trim()) para(o.body.trim(), "normal", 4);
  if (o.note.trim()) para("NOTE: " + o.note.trim(), "bold", 3);

  const timed = o.rows.some(r => r.length > 6);
  autoTable(doc, {
    startY: y + 1,
    margin: { left: L, right: R, top: 16, bottom: 16 },
    head: [timed ? ["Name", "Branch", "Roll No.", "Student ID", "Division", "Year", "Timing"] : ["Name", "Branch", "Roll No.", "Student ID", "Division", "Year"]],
    body: o.rows,
    theme: "grid",
    styles: { font: "helvetica", fontSize: timed ? 7.2 : 7.6, textColor: 20, lineColor: 30, lineWidth: 0.2, cellPadding: { top: 1.3, bottom: 1.3, left: 1.6, right: 1.6 } },
    headStyles: { fillColor: 255, textColor: 0, fontStyle: "bold", fontSize: 8 },
    columnStyles: timed
      ? { 0: { cellWidth: 43 }, 1: { cellWidth: 18 }, 2: { cellWidth: 17 }, 3: { cellWidth: 28 }, 4: { cellWidth: 18 }, 5: { cellWidth: 12 }, 6: { cellWidth: 38 } }
      : { 0: { cellWidth: 52 }, 1: { cellWidth: 23 }, 2: { cellWidth: 22 }, 3: { cellWidth: 33 }, 4: { cellWidth: 24 }, 5: { cellWidth: 20 } },
    showHead: "everyPage",
  });

  let sy = doc.lastAutoTable.finalY + 26;
  if (sy + 12 > H - 16) { doc.addPage(); sy = 40; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lx = L + TW * 0.25, rx = L + TW * 0.75;
  doc.text("DJS Trinity", lx, sy, { align: "center" });
  doc.text("Top Core", lx, sy + 6, { align: "center" });
  doc.text("DJS Trinity", rx, sy, { align: "center" });
  doc.text("(Convener)", rx - 13, sy + 6, { align: "center" });
  doc.text("(Co-Convener)", rx + 13, sy + 6, { align: "center" });
  return doc;
}
if (typeof module !== "undefined") module.exports = { buildLetter };
