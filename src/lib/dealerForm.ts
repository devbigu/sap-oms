export type StaffMember = {
  staff_id: string;
  staff_name: string;
  staff_roletype: string | number;
};

export type DealerFormValues = {
  name: string;
  email: string;
  whatsapp: string;
  city: string;
  address: string;
  pincode: string;
  dealerCode: string;
  username: string;
  password: string;
  gstNo: string;
  discount: string;
  creditDays: string;
  annualTarget: string;
  currentLimit: string;
  notes: string;
};

export type DealerFormSnapshot = DealerFormValues & {
  assignedStaffIds: string[];
  staffNames: string;
};

export const emptyDealerForm: DealerFormValues = {
  name: "",
  email: "",
  whatsapp: "",
  city: "",
  address: "",
  pincode: "",
  dealerCode: "",
  username: "",
  password: "",
  gstNo: "",
  discount: "",
  creditDays: "",
  annualTarget: "",
  currentLimit: "",
  notes: "",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStaffIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizeStaffIds(entry))
      .filter(Boolean);
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

export function getAssignedStaffNames(selectedStaff: string[], staffList: StaffMember[]) {
  return selectedStaff
    .map((staffId) => staffList.find((staff) => String(staff.staff_id) === String(staffId))?.staff_name ?? "")
    .filter(Boolean)
    .join(",");
}

export function normalizeDealerFormSnapshot(value: unknown): DealerFormSnapshot {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    name: cleanText(source.name),
    email: cleanText(source.email),
    whatsapp: cleanText(source.whatsapp),
    city: cleanText(source.city),
    address: cleanText(source.address),
    pincode: cleanText(source.pincode),
    dealerCode: cleanText(source.dealerCode),
    username: cleanText(source.username),
    password: cleanText(source.password),
    gstNo: cleanText(source.gstNo),
    discount: cleanText(source.discount),
    creditDays: cleanText(source.creditDays),
    annualTarget: cleanText(source.annualTarget),
    currentLimit: cleanText(source.currentLimit),
    notes: cleanText(source.notes),
    assignedStaffIds: normalizeStaffIds(source.assignedStaffIds),
    staffNames: cleanText(source.staffNames),
  };
}

export function validateDealerFormSnapshot(snapshot: DealerFormSnapshot): string | null {
  const requiredFields: Array<{ key: keyof DealerFormSnapshot; label: string }> = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email address" },
    { key: "whatsapp", label: "WhatsApp number" },
    { key: "city", label: "City" },
    { key: "address", label: "Bill-to address" },
    { key: "pincode", label: "Pin code" },
    { key: "dealerCode", label: "Dealer code" },
    { key: "username", label: "Username" },
    { key: "password", label: "Password" },
    { key: "gstNo", label: "GST number" },
    { key: "discount", label: "Discount %" },
    { key: "creditDays", label: "Credit days" },
    { key: "annualTarget", label: "Annual target" },
    { key: "currentLimit", label: "Current limit" },
  ];

  for (const field of requiredFields) {
    if (!cleanText(snapshot[field.key])) {
      return `${field.label} is required`;
    }
  }

  if (!snapshot.assignedStaffIds.length) {
    return "Please assign at least one staff member";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.email)) {
    return "Enter a valid email address";
  }

  return null;
}

export function buildDealerPhpFormData(snapshot: DealerFormSnapshot): FormData {
  const formData = new FormData();

  formData.append("Dealer_Name", snapshot.name);
  formData.append("Dealer_Email", snapshot.email);
  formData.append("Dealer_Number", snapshot.whatsapp);
  formData.append("Dealer_City", snapshot.city);
  formData.append("Dealer_Address", snapshot.address);
  formData.append("Dealer_Pincode", snapshot.pincode);
  formData.append("Dealer_Dealercode", snapshot.dealerCode);
  formData.append("Dealer_Username", snapshot.username);
  formData.append("Dealer_Password", snapshot.password);
  formData.append("gst", snapshot.gstNo);
  formData.append("discount", snapshot.discount);
  formData.append("creditdays", snapshot.creditDays);
  formData.append("annualtarget", snapshot.annualTarget);
  formData.append("currentlimit", snapshot.currentLimit);
  formData.append("Dealer_Notes", snapshot.notes);
  formData.append("assignedstaff", snapshot.assignedStaffIds.join(","));
  formData.append("staffname", snapshot.staffNames);

  return formData;
}

export function toDealerFormSnapshot(
  values: DealerFormValues,
  assignedStaffIds: string[],
  staffNames: string,
): DealerFormSnapshot {
  return normalizeDealerFormSnapshot({
    ...values,
    assignedStaffIds,
    staffNames,
  });
}
