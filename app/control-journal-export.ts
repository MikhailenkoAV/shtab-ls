import { ControlRow, isControlAttention } from "./control-journal-rules";

const kindLabels = {
  type: "Тип",
  night: "Ночь",
  certification: "Контроль",
};

function displayDate(value: string): string {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`)) : "—";
}

export async function downloadControlJournalExcel(rows: ControlRow[], dateFrom: string, dateTo: string) {
  if (!dateFrom || !dateTo || dateTo < dateFrom) throw new Error("Проверьте выбранный период.");
  const selected = rows
    .filter((row) => isControlAttention(row) && row.dueDate && row.dueDate >= dateFrom && row.dueDate <= dateTo)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.personName.localeCompare(right.personName, "ru-RU"));
  if (!selected.length) throw new Error("В выбранном периоде нет контрольных сроков.");

  const XLSXModule = await import("xlsx-js-style");
  const XLSX = XLSXModule.default ?? XLSXModule;
  const data = [
    ["Контрольный журнал — сроки, требующие внимания"],
    [`Период: ${displayDate(dateFrom)} — ${displayDate(dateTo)}`],
    ["Раздел", "Сотрудник", "Тип ВС / документ", "Последний полёт / начало", "Срок", "Осталось дней", "Состояние"],
    ...selected.map((row) => [
      kindLabels[row.kind],
      row.personName,
      row.kind === "certification" ? [row.subject, row.aircraftType].filter(Boolean).join(" · ") : row.aircraftType,
      displayDate(row.referenceDate),
      displayDate(row.dueDate),
      row.daysLeft ?? "",
      row.statusLabel,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const thinBorder = {
    top: { style: "thin", color: { rgb: "C8D4D9" } },
    bottom: { style: "thin", color: { rgb: "C8D4D9" } },
    left: { style: "thin", color: { rgb: "C8D4D9" } },
    right: { style: "thin", color: { rgb: "C8D4D9" } },
  };
  const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } });
  const setStyle = (row: number, column: number, style: Record<string, unknown>) => {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    if (!sheet[address]) sheet[address] = { t: "s", v: "" };
    sheet[address].s = style;
  };
  for (let column = 0; column < 7; column += 1) {
    setStyle(0, column, {
      fill: fill("17384C"),
      font: { name: "Arial", sz: 15, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    setStyle(1, column, {
      fill: fill("0D8D82"),
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    setStyle(2, column, {
      fill: fill("DDE9EC"),
      font: { name: "Arial", sz: 9, bold: true, color: { rgb: "294652" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: thinBorder,
    });
  }
  selected.forEach((row, index) => {
    const excelRow = index + 3;
    const rowFill = row.status === "expired" ? "FCE5E3"
      : row.status === "alert14" ? "FCEBD8"
        : row.status === "alert45" ? "FFF5CF"
          : row.status === "incomplete" ? "ECEFF1"
            : "E8F3EE";
    for (let column = 0; column < 7; column += 1) {
      setStyle(excelRow, column, {
        fill: fill(rowFill),
        font: { name: "Arial", sz: 9, color: { rgb: "2C4655" } },
        alignment: { horizontal: column === 1 || column === 2 ? "left" : "center", vertical: "center", wrapText: true },
        border: thinBorder,
      });
    }
  });
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];
  sheet["!cols"] = [{ wch: 18 }, { wch: 34 }, { wch: 34 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 24 }];
  sheet["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 32 }, ...selected.map(() => ({ hpt: 28 }))];
  sheet["!autofilter"] = { ref: `A3:G${data.length}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Контроль");
  XLSX.writeFile(workbook, `kontrolnyy-zhurnal-${dateFrom}-${dateTo}.xlsx`);
}
