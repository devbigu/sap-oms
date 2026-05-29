import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/Exporttopdf";
import moment from "moment";
import { hasPriorityTag } from "@/lib/orderPriority";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface OrderInvoiceData {
    order_id: string;
    order_date: string;
    order_amount: string;
    order_discount: string;
    Dealer_Name: string;
    orderdata_item_quantity: string;
    mtstatus: string;
    outstandingDate?: string;
    reason?: string;
    product_name?: string;
    
}

export interface DealerProfile {
    Dealer_Id?: string;
    Dealer_Name?: string;
    Dealer_Email?: string;
    Dealer_Number?: string;
    Dealer_Address?: string;
    Dealer_shipto?: string;
    Dealer_City?: string;
    Dealer_Pincode?: string;
    Dealer_Dealercode?: string;
    Dealer_Notes?: string;
    gst?: string;
    creditdays?: string;
    discount?: string;
    staffname?: string;
}

export interface InvoiceResult {
    success: boolean;
    message: string;
    url?: string;
    invoiceId?: string;
    error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

interface OrderItem {
    orderdata_id: string;
    orderdata_cat_no: string;
    orderdata_item_quantity: string;
    orderdata_price: string;
    orderdata_discount: string;
    orderdata_afterDisPrice: string;
    product_name: string;
    product_discription?: string;
    product_unit?: string;
    discount?: string;
    remark?: string;
    remarks?: string;
    priority?: string | boolean;
    isPriority?: string | boolean;
    is_priority?: string | boolean;
}

async function fetchOrderItems(orderId: string): Promise<OrderItem[]> {
    try {
        const res = await fetch(`${BACKEND_URL}/orderdatalist?id=${orderId}`);
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json.data) ? json.data : [];
    } catch {
        return [];
    }
}

function invoiceNumber(orderId: string): string {
    return `OM/${new Date().getFullYear()}/${orderId}`;
}

function fmt(n: number): string {
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDealerProfile(): DealerProfile | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return null;
        const p = JSON.parse(raw);
        return p?.Dealer_Id ? (p as DealerProfile) : null;
    } catch {
        return null;
    }
}

const OMSONS_LOGO_URL = "data:image/jpeg;base64,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";

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

function toWords(amount: number): string {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function words(n: number): string {
        if (n === 0) return "";
        if (n < 20) return ones[n] + " ";
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
        if (n < 1_000) return ones[Math.floor(n / 100)] + " Hundred " + words(n % 100);
        if (n < 1_00_000) return words(Math.floor(n / 1_000)) + "Thousand " + words(n % 1_000);
        if (n < 1_00_00_000) return words(Math.floor(n / 1_00_000)) + "Lakh " + words(n % 1_00_000);
        return words(Math.floor(n / 1_00_00_000)) + "Crore " + words(n % 1_00_00_000);
    }
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let out = (words(rupees).trim() || "Zero") + " Rupees";
    if (paise > 0) out += " and " + words(paise).trim() + " Paise";
    return out + " Only";
}

function cell(
    doc: jsPDF,
    x: number, y: number, w: number, h: number,
    text: string,
    opts: { bold?: boolean; align?: "left" | "right" | "center"; fontSize?: number; paddingX?: number } = {}
) {
    doc.rect(x, y, w, h);
    doc.setFont("Helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.fontSize ?? 7.5);
    const px = opts.paddingX ?? 2;
    const tx = opts.align === "right" ? x + w - px : opts.align === "center" ? x + w / 2 : x + px;
    doc.text(text, tx, y + h * 0.62, { align: opts.align ?? "left" });
}

// ─── Main PDF Generator ───────────────────────────────────────────────────────
export async function generateOrderInvoicePDF(order: OrderInvoiceData): Promise<Blob> {
    const dp = getDealerProfile();

    // Fetch detailed order items (product names) from the API
    const orderItems = await fetchOrderItems(order.order_id);

    const doc = new jsPDF("p", "mm", "a4");
    const PW = doc.internal.pageSize.getWidth();
    const ML = 14;
    const MR = 14;
    const CW = PW - ML - MR;

    const gross    = Number(order.order_amount);
    const discount = Number(order.order_discount);
    const net      = gross - discount;
    const invNo    = invoiceNumber(order.order_id);

    // Shared inner padding used consistently everywhere
    const PAD = 4;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);

    let y = 12;

    // ── LOGO ─────────────────────────────────────────────────────────────────
    const LOGO_W = 28;
    const LOGO_H = 16;

    try {
        const logoImg = await loadImage(OMSONS_LOGO_URL);
        doc.addImage(logoImg, "JPEG", ML, y, LOGO_W, LOGO_H);
    } catch {
        console.warn("Logo could not be loaded; skipping.");
    }

    // ── HEADER — 8 mm gap between logo right edge and company name ───────────
    const infoX = ML + LOGO_W + 8;   // ← was +5

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Omsons Glassware Pvt. Ltd.", infoX, y + 6);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    [
        "KHATA No. 278/364 AND 285/372 HADBAST No. 66 Khuda Kalan to Sapehra Road, P.O. Pilkhani,",
        "Ambala, Haryana 133104, India",
        "Email: info@omsonsglass.com  |  Phone: +91-1234567890",
        "PAN: AAACO1234F  |  GSTIN: 06AAACO1234F1Z5  |  CIN: U12345HR2000PTC012345",
    ].forEach((line, i) => doc.text(line, infoX, y + 11 + i * 4));

    y += LOGO_H + 10;   // ← was +8; extra bottom room below header

    // ── SEPARATOR — consistent left/right margins ─────────────────────────────
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.4);
    doc.line(ML, y, PW - MR, y);   // ML … PW-MR — same as all boxes
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    y += 6;

    // ── DOCUMENT TITLE ────────────────────────────────────────────────────────
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    const titleStr = "ORDER INVOICE";
    const titleW   = doc.getTextWidth(titleStr);
    const titleX   = PW / 2;
    doc.text(titleStr, titleX, y, { align: "center" });
    doc.setLineWidth(0.35);
    doc.line(titleX - titleW / 2, y + 0.8, titleX + titleW / 2, y + 0.8);
    doc.setLineWidth(0.2);
    y += 6;

    // ── META TABLE ────────────────────────────────────────────────────────────
    const half = CW / 2;
    const LBW  = 32;
    const VW   = half - LBW;
    const RH   = 6;

    const metaRows: [string, string, string, string][] = [
        ["Invoice No",  invNo,
         "Invoice Date", moment(order.order_date).format("DD-MM-YYYY")],
        ["Order Date",  moment(order.order_date).format("DD-MM-YYYY"),
         "Order Time",  moment(order.order_date).format("hh:mm A")],
        ["Dealer",      dp?.Dealer_Name || order.Dealer_Name || "—",
         "Outstanding Date", order.outstandingDate ? moment(order.outstandingDate).format("DD-MM-YYYY") : "—"],
    ];

    metaRows.forEach(([l1, v1, l2, v2], i) => {
        const ry = y + i * RH;
        cell(doc, ML,          ry, LBW, RH, l1, { bold: true });
        cell(doc, ML + LBW,    ry, VW,  RH, v1);
        cell(doc, ML + half,   ry, LBW, RH, l2, { bold: true });
        cell(doc, ML + half + LBW, ry, VW, RH, v2);
    });

    y += metaRows.length * RH + 5;

    // ── DEALER / SHIP-TO ──────────────────────────────────────────────────────
    const SEC_HDR_H = 6;

    const dealerLines: [string, string][] = [];
    if (dp?.Dealer_Name)    dealerLines.push(["Name",    dp.Dealer_Name]);
    if (dp?.Dealer_Address) dealerLines.push(["Address", dp.Dealer_Address]);
    if (dp?.Dealer_City)    dealerLines.push(["City",    dp.Dealer_City]);
    if (dp?.gst)            dealerLines.push(["GST No",  dp.gst]);
    if (dp?.Dealer_Number)  dealerLines.push(["Phone",   dp.Dealer_Number]);
    if (dp?.Dealer_Email)   dealerLines.push(["Email",   dp.Dealer_Email]);
    if (dealerLines.length === 0 && order.Dealer_Name)
        dealerLines.push(["Name", order.Dealer_Name]);

    const ROW_STEP    = 5.2;
    const DEALER_BOD_H = Math.max(28, dealerLines.length * ROW_STEP + 10);
    const LAB_W = 24;   // label column inside dealer boxes

    cell(doc, ML,        y, half, SEC_HDR_H, "Details of Dealer / Vendor", { bold: true });
    cell(doc, ML + half, y, half, SEC_HDR_H, "Ship To Details",            { bold: true });
    y += SEC_HDR_H;

    doc.rect(ML,        y, half, DEALER_BOD_H);
    doc.rect(ML + half, y, half, DEALER_BOD_H);

    // Dealer rows — PAD from left, LAB_W for label column
    dealerLines.forEach(([label, value], i) => {
        const lineY = y + 7 + i * ROW_STEP;
        doc.setFont("Helvetica", "bold");   doc.setFontSize(7.5);
        doc.text(`${label} :`, ML + PAD, lineY);
        doc.setFont("Helvetica", "normal");
        const wrapped = doc.splitTextToSize(value, half - PAD - LAB_W - PAD);
        doc.text(wrapped[0], ML + PAD + LAB_W, lineY);
    });

    // Ship To — same PAD / LAB_W convention
    const shipAddr = dp?.Dealer_shipto
        || "Omsons Glassware Pvt. Ltd., KHATA No. 278/364 AND 285/372 HADBAST No. 66, Ambala, Haryana 133104";

    doc.setFont("Helvetica", "bold");   doc.setFontSize(7.5);
    doc.text("Name :",    ML + half + PAD, y + 7);
    doc.text("Address :", ML + half + PAD, y + 13);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7);
    doc.text(dp?.Dealer_Name || order.Dealer_Name || "—", ML + half + PAD + LAB_W, y + 7);
    const shipWrapped = doc.splitTextToSize(shipAddr, half - PAD - LAB_W - PAD);
    doc.text(shipWrapped, ML + half + PAD + LAB_W, y + 13);

    y += DEALER_BOD_H + 5;

    // ── ITEMS LABEL ───────────────────────────────────────────────────────────
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Items", ML, y);
    y += 4;

    // ── ITEMS TABLE ───────────────────────────────────────────────────────────
    // Build item rows from fetched order items, or fall back to a single row
    const itemRows: any[][] = [];
    let totalQty = 0;

    if (orderItems.length > 0) {
        orderItems.forEach((item, idx) => {
            const itemGross    = Number(item.orderdata_price) * Number(item.orderdata_item_quantity);
            const itemDiscount = Number(item.orderdata_discount || 0);
            const itemNet      = Number(item.orderdata_afterDisPrice || (itemGross - itemDiscount));
            const qty          = Number(item.orderdata_item_quantity);
            const isPriority   = hasPriorityTag(item.priority, item.isPriority, item.is_priority, item.remark, item.remarks);
            const description  = `${item.product_name || item.orderdata_cat_no || "—"}${isPriority ? "\n[PRIORITY DELIVERY]" : ""}`;
            totalQty += qty;

            itemRows.push([
                { content: String(idx + 1).padStart(2, "0"),          styles: { halign: "center" } },
                { content: description,                                styles: { halign: "left" } },
                { content: String(qty),                                styles: { halign: "center" } },
                { content: item.product_unit || "Pcs",                 styles: { halign: "center" } },
                { content: fmt(itemGross),                             styles: { halign: "right"  } },
                { content: fmt(itemDiscount),                          styles: { halign: "right"  } },
                { content: fmt(itemNet),                               styles: { halign: "right"  } },
            ]);
        });
    } else {
        // Fallback: single row with whatever info we have
        totalQty = Number(order.orderdata_item_quantity);
        itemRows.push([
            { content: "01",                                                   styles: { halign: "center" } },
            { content: order.product_name || "Omsons Glassware Products",       styles: { halign: "left"   } },
            { content: order.orderdata_item_quantity,                           styles: { halign: "center" } },
            { content: "Pcs",                                                  styles: { halign: "center" } },
            { content: fmt(gross),                                             styles: { halign: "right"  } },
            { content: fmt(discount),                                          styles: { halign: "right"  } },
            { content: fmt(net),                                               styles: { halign: "right"  } },
        ]);
    }

    // Totals row
    itemRows.push([
        { content: "Total", colSpan: 2,                    styles: { halign: "right", fontStyle: "bold" } },
        { content: String(totalQty),                       styles: { halign: "center", fontStyle: "bold" } },
        { content: "",                                     styles: {} },
        { content: fmt(gross),                             styles: { halign: "right", fontStyle: "bold" } },
        { content: fmt(discount),                          styles: { halign: "right", fontStyle: "bold" } },
        { content: fmt(net),                               styles: { halign: "right", fontStyle: "bold" } },
    ]);

    autoTable(doc, {
        startY: y,
        head: [[
            { content: "Sr\nNo",          styles: { halign: "center", cellWidth: 10 } },
            { content: "Description",      styles: { halign: "left",   cellWidth: "auto" as const } },
            { content: "Qty",              styles: { halign: "center", cellWidth: 14 } },
            { content: "UOM",              styles: { halign: "center", cellWidth: 13 } },
            { content: "Gross Amt\n(Rs.)", styles: { halign: "right",  cellWidth: 28 } },
            { content: "Discount\n(Rs.)",  styles: { halign: "right",  cellWidth: 26 } },
            { content: "Net Amt\n(Rs.)",   styles: { halign: "right",  cellWidth: 26 } },
        ]],
        body: itemRows,
        margin: { left: ML, right: MR },
        styles: {
            font: "Helvetica", fontSize: 8,
            cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
            textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.2,
            fillColor: [255, 255, 255], overflow: "linebreak",
        },
        headStyles: {
            fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold",
            lineColor: [0, 0, 0], lineWidth: 0.2, valign: "middle", minCellHeight: 10,
        },
        alternateRowStyles: { fillColor: [255, 255, 255] },
    });

    y = (doc as any).lastAutoTable.finalY + 3;

    // ── REMARKS + T&C (left) | SUMMARY (right) ───────────────────────────────
    const SUM_W  = 78;
    const LEFT_W = CW - SUM_W;
    const REM_H  = 22;

    // T&C height: PAD top + header line + gap + lines + PAD bottom
    const TC_LINE_H = 4;
    const TC_H = PAD + 5 + 3 + tcLines().length * TC_LINE_H + PAD;
    const TOTAL_L_H = REM_H + TC_H;

    // Remarks
    doc.rect(ML, y, LEFT_W, REM_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8);
    doc.text("Remarks", ML + PAD, y + PAD + 2);
    doc.rect(ML + PAD, y + PAD + 4, LEFT_W - PAD * 2, REM_H - PAD * 2 - 4);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    const remarkLines = order.reason
        ? doc.splitTextToSize(order.reason, LEFT_W - PAD * 2 - 4)
        : ["N/A"];
    doc.text(remarkLines, ML + PAD + 2, y + PAD + 4 + 4);

    // T&C — all four sides use PAD
    const tcY = y + REM_H;
    doc.rect(ML, tcY, LEFT_W, TC_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8);
    doc.text("Terms & Conditions", ML + PAD, tcY + PAD + 3);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    tcLines().forEach((t, i) =>
        doc.text(
            `${i + 1}. ${t}`,
            ML + PAD,                                       // ← left = PAD
            tcY + PAD + 3 + 4 + i * TC_LINE_H              // ← top = PAD
        )
    );

    // Summary
    const sx    = ML + LEFT_W;
    const ROW_H = 6;
    const sumItems = [
        { label: "Gross Amount", value: fmt(gross),    bold: false },
        { label: "Discount",     value: fmt(discount),  bold: false },
        { label: "Net Amount",   value: fmt(net),       bold: true  },
    ];
    doc.rect(sx, y, SUM_W, TOTAL_L_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8.5);
    doc.text("Summary", sx + PAD, y + 6);
    const LW  = SUM_W * 0.55;
    const VW2 = SUM_W - LW;
    let sy = y + 10;
    sumItems.forEach(item => {
        doc.rect(sx, sy, LW, ROW_H);
        doc.rect(sx + LW, sy, VW2, ROW_H);
        doc.setFont("Helvetica", item.bold ? "bold" : "normal"); doc.setFontSize(7.5);
        doc.text(item.label, sx + PAD, sy + ROW_H * 0.63);
        doc.text(`Rs. ${item.value}`, sx + SUM_W - PAD, sy + ROW_H * 0.63, { align: "right" });
        sy += ROW_H;
    });

    y += TOTAL_L_H;

    // ── AMOUNT IN WORDS ───────────────────────────────────────────────────────
    const FRH = 6;
    doc.rect(ML, y, CW, FRH);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Amount in Words:", ML + PAD, y + FRH * 0.63);
    doc.setFont("Helvetica", "normal");
    const wordsText    = toWords(net);
    const wrappedWords = doc.splitTextToSize(wordsText, CW - 40);
    doc.text(wrappedWords[0], ML + 36, y + FRH * 0.63);
    y += FRH;

    // ── PAYMENT TERMS ─────────────────────────────────────────────────────────
    doc.rect(ML, y, CW, FRH);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Payment Terms:", ML + PAD, y + FRH * 0.63);
    doc.setFont("Helvetica", "normal");
    const pt = dp?.creditdays ? `Net ${dp.creditdays} days` : "Net 30";
    doc.text(pt, ML + 32, y + FRH * 0.63);
    y += FRH + 14;

    // ── SIGNATURES ────────────────────────────────────────────────────────────
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    doc.text("Checked By", ML, y);
    doc.setLineWidth(0.3);
    doc.line(ML, y + 8, ML + 50, y + 8);
    doc.setLineWidth(0.2);
    doc.text("Signature & Date", ML, y + 12);

    const PW_R = PW - MR;
    doc.setFont("Helvetica", "bold");
    doc.text("For Omsons Glassware Pvt. Ltd.", PW_R, y, { align: "right" });
    doc.setFont("Helvetica", "normal");
    doc.text("Authorized Signatory", PW_R, y + 14, { align: "right" });
    y += 22;

    // ── PAGE FOOTER ───────────────────────────────────────────────────────────
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Page 1 of 1", PW_R, y, { align: "right" });
    doc.setFont("Helvetica", "italic");
    doc.text("Powered by Teemers ERP", PW_R, y + 4, { align: "right" });
    doc.setTextColor(0, 0, 0);

    return doc.output("blob");
}

// ── T&C lines extracted so they can be reused for height calc ────────────────
function tcLines(): string[] {
    return [
        "Goods once sold will not be taken back.",
        "Delivery timeline as discussed.",
        "Payment terms as agreed.",
        "Any damage must be reported within 48 hours.",
        "Taxes as applicable.",
        "Subject to Ambala, Haryana jurisdiction.",
    ];
}

// ─── Upload to Supabase ────────────────────────────────────────────────────────
export async function uploadOrderInvoiceToSupabase(
    pdfBlob: Blob,
    order: OrderInvoiceData
): Promise<InvoiceResult> {
    try {
        const invNo     = invoiceNumber(order.order_id);
        const timestamp = moment().format("YYYY-MM-DD_HH-mm-ss");
        const safeInv   = invNo.replace(/[^a-z0-9-._]/gi, "_");
        const filePath  = `invoices/${safeInv}_${timestamp}.pdf`;
        const invoiceId = `${safeInv}_${timestamp}`;
        const net       = Number(order.order_amount) - Number(order.order_discount);

        const { error: upErr } = await supabase.storage
            .from("invoices")
            .upload(filePath, pdfBlob, { contentType: "application/pdf", upsert: false });
        if (upErr) return { success: false, message: "Upload failed", error: upErr.message };

        const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(filePath);

        const dp = getDealerProfile();
        const { error: dbErr } = await supabase.from("invoices").insert([{
            invoice_id:     invoiceId,
            invoice_number: invNo,
            dealer_id:      dp?.Dealer_Id || order.order_id,
            buyer_name:     dp?.Dealer_Name || order.Dealer_Name,
            file_url:       urlData.publicUrl,
            file_path:      filePath,
            invoice_date:   order.order_date,
            total_amount:   net,
            created_at:     new Date().toISOString(),
        }]);
        if (dbErr) console.warn("Metadata save failed (PDF uploaded):", dbErr.message);

        return { success: true, message: "Invoice uploaded", url: urlData.publicUrl, invoiceId };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown" };
    }
}

// ─── Download to device ────────────────────────────────────────────────────────
export async function downloadOrderInvoice(order: OrderInvoiceData): Promise<InvoiceResult> {
    try {
        const blob = await generateOrderInvoicePDF(order);
        const url  = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href     = url;
        link.download = `${invoiceNumber(order.order_id).replace(/\//g, "-")}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return { success: true, message: "Downloaded" };
    } catch (err) {
        return { success: false, message: "Download failed", error: err instanceof Error ? err.message : "Unknown" };
    }
}

// ─── List invoices ─────────────────────────────────────────────────────────────
export async function listInvoices(_dealerId: string, limit = 100) {
    try {
        const { data, error } = await supabase
            .from("invoices").select("*")
            .order("created_at", { ascending: false }).limit(limit);
        if (error) return { success: false, message: "Failed", error: error.message, data: [] };
        return { success: true, message: "OK", data: data || [] };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown", data: [] };
    }
}

// ─── Delete invoice ────────────────────────────────────────────────────────────
export async function deleteInvoice(invoiceId: string, filePath: string) {
    try {
        await supabase.storage.from("invoices").remove([filePath]);
        const { error } = await supabase.from("invoices").delete().eq("invoice_id", invoiceId);
        if (error) return { success: false, message: "Delete failed", error: error.message };
        return { success: true, message: "Deleted" };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown" };
    }
}
