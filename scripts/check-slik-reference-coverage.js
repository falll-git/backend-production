const path = require("path");
const ExcelJS = require("exceljs");
const { resolveSlikReference } = require("../src/utils/slik-reference-dictionary");

const workbookPath = process.argv[2] || "D:\\7-2023.xlsx";

const SHEET_SPECS = {
  D01: {
    firstDataRow: 3,
    fields: {
      C: ["identity_type_code", "identity_type_code"],
      G: ["education_degree_code", "education_degree_code"],
      H: ["gender", "gender"],
      O: ["city_code", "city_code"],
      T: ["domicile_country_code", "country_code"],
      U: ["occupation_code", "occupation_code"],
      W: ["workplace_business_field_code", "business_field_code"],
      Z: ["income_source_code", "income_source_code"],
      AB: ["relationship_with_reporter_code", "relationship_with_reporter_code"],
      AC: ["debtor_group_code", "debtor_group_code"],
      AD: ["marital_status_code", "marital_status_code"],
      AH: ["separate_assets_agreement", "separate_assets_agreement"],
      AI: ["violates_bmpk", "bmpk_violation_status"],
      AJ: ["exceeds_bmpk", "bmpk_exceed_status"],
      AM: ["operation_code", "operation_code"],
    },
  },
  D02: {
    firstDataRow: 4,
    fields: {
      E: ["legal_form_code", "legal_form_code"],
      Q: ["city_code", "city_code"],
      S: ["domicile_country_code", "country_code"],
      T: ["business_field_code", "business_field_code"],
      U: ["relationship_with_reporter_code", "relationship_with_reporter_code"],
      V: ["violates_bmpk", "bmpk_violation_status"],
      W: ["exceeds_bmpk", "bmpk_exceed_status"],
      X: ["go_public", "go_public_status"],
      Y: ["debtor_group_code", "debtor_group_code"],
      AA: ["rating_agency", "rating_agency_code"],
      AE: ["operation_code", "operation_code"],
    },
  },
  F01: {
    firstDataRow: 4,
    fields: {
      D: ["credit_nature_code", "credit_nature_code"],
      E: ["credit_type_code", "credit_type_code"],
      F: ["financing_scheme_code", "financing_scheme_code"],
      O: ["debtor_category_code", "debtor_category_code"],
      P: ["usage_type_code", "usage_type_code"],
      Q: ["usage_orientation_code", "usage_orientation_code"],
      R: ["economic_sector_code", "economic_sector_code"],
      S: ["project_location_city_code", "city_code"],
      U: ["currency_code", "currency_code"],
      W: ["interest_type_code", "interest_type_code"],
      X: ["government_program_code", "government_program_code"],
      AG: ["collectibility_code", "collectibility_code"],
      AI: ["default_reason_code", "default_reason_code"],
      AQ: ["restructuring_method_code", "restructuring_method_code"],
      AR: ["condition_code", "condition_code"],
      AV: ["operation_code", "operation_code"],
    },
  },
  A01: {
    firstDataRow: 4,
    fields: {
      E: ["facility_segment_code", "facility_segment_code"],
      F: ["collateral_status_code", "collateral_status_code"],
      G: ["collateral_type", "collateral_type"],
      I: ["rating_agency_code", "rating_agency_code"],
      J: ["binding_type_code", "binding_type_code"],
      O: ["location_city_code", "city_code"],
      V: ["paripasu_status", "paripasu_status"],
      X: ["joint_credit_status", "joint_credit_status"],
      Y: ["insured_status", "insured_status"],
      AB: ["operation_code", "operation_code"],
    },
  },
};

function columnNumber(column) {
  return column.split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function cellText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const report = {
    workbook: path.resolve(workbookPath),
    sheets: {},
  };
  let hasUnmappedCodes = false;

  for (const [sheetName, spec] of Object.entries(SHEET_SPECS)) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      report.sheets[sheetName] = { error: "Sheet not found" };
      continue;
    }

    const fields = {};
    for (const [column, [field, category]] of Object.entries(spec.fields)) {
      const values = new Map();
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < spec.firstDataRow) return;
        const code = cellText(row.getCell(columnNumber(column)).value);
        if (!code) return;
        values.set(code, (values.get(code) || 0) + 1);
      });

      const mapped = [];
      const unmapped = [];
      for (const [code, count] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const reference = resolveSlikReference(category, code);
        const item = { code, count };
        if (reference?.is_mapped) mapped.push({ ...item, label: reference.label });
        else unmapped.push(item);
      }

      fields[field] = {
        category,
        unique_codes: values.size,
        mapped_codes: mapped.length,
        unmapped_codes: unmapped.length,
        mapped,
        unmapped,
      };
      if (unmapped.length > 0) hasUnmappedCodes = true;
    }

    report.sheets[sheetName] = { fields };
  }

  console.log(JSON.stringify(report, null, 2));
  if (hasUnmappedCodes) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
