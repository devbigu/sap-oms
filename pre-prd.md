# Omsons Ecommerce Rebuild: Pre-PRD

Status: Draft foundation  
Audit date: 2026-07-16  
Source: Current Next.js application in this repository

## 1. Purpose

This document captures what the current Omsons application does, where its product value lies, which implementation choices are risky, and what a new ecommerce platform should retain or redesign.

It is a pre-PRD rather than a final specification. It should be used to align product, design, engineering, sales, operations, and finance before detailed wireframes, schemas, API contracts, estimates, and delivery plans are approved.

## 2. Executive Summary

The current app is a B2B laboratory-products ordering portal plus an internal operations system. It is not a conventional consumer storefront. Its differentiators are:

- A large technical catalogue with product families, variants, specifications, pack sizes, SKUs, images, HSN codes, and request-only pricing.
- Dealer-specific ordering with base discounts, slab discounts, coupons, custom discount approval, priority lines, drafts, bulk spreadsheet import, notes, and shipping references.
- Role-specific workspaces for dealers, staff, administrators, and accountants.
- Post-order operations including status tracking, product-level dispatch, invoices, pending-product views, ledgers, wallet adjustments, and reports.

The rebuild should keep these B2B workflows but replace the current fragmented architecture with one authenticated, server-authorized system and one canonical product/order model.

## 3. Current Application Snapshot

Repository inventory at audit time:

| Item | Current count or technology |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 |
| Pages | 60 `page.tsx` files |
| Internal APIs | 31 route files |
| Roles | Admin, staff, dealer, accountant |
| Catalogue products | 1,295 product families |
| Catalogue variants | 5,125 variants |
| Catalogue images | 1,528 image references |
| Products with at least one request-only variant | 86 |
| Automated unit test files | 16 Node test files |
| State/data libraries | Zustand, TanStack Query, Axios |
| Persistence/services | External PHP API, MongoDB, Supabase, static JSON, browser storage |
| Export tools | PDF, CSV, XLSX |

The current catalogue source is `public/data/omsons_products_from_excel_with_images.json`. Other older catalogue files remain in `public/data` and are still used by a few order/cart/invoice paths.

## 4. Product Vision for the Rebuild

Create a dependable B2B ecommerce and order-operations platform for Omsons laboratory products that lets approved dealers find technical products quickly, build accurate orders, request commercial approvals, track fulfillment, and reconcile accounts, while giving staff and administrators controlled operational tools.

The new experience should feel like a focused procurement system: fast to search, precise about specifications and prices, efficient for repeat ordering, and transparent about approvals, stock, dispatch, and balances.

## 5. Product Goals

1. Establish one trusted product catalogue and pricing source.
2. Make SKU, specification, category, and product-name search reliable across all surfaces.
3. Support high-volume B2B order entry without forcing users through a consumer checkout pattern.
4. Make dealer pricing and every discount component explainable and auditable.
5. Enforce authentication and permissions on the server for every protected read and write.
6. Give operations a clear order-to-dispatch workflow with product-level quantities and status history.
7. Give finance a consistent ledger, payment, wallet, invoice, and outstanding-balance view.
8. Reduce support issues caused by stale data, hidden failures, duplicated screens, and oversized client bundles.
9. Make catalogue imports, data corrections, and product-image updates safe and observable.
10. Provide automated coverage for the revenue-critical paths and the previously observed client/chunk crash class.

## 6. Non-Goals for the First Release

- A public consumer marketplace with anonymous checkout.
- Multiple sellers or marketplace commissions.
- International tax and multi-currency support unless separately approved.
- Full ERP replacement.
- Native mobile apps. The web app must instead be fully responsive and installable later if needed.
- AI-dependent search. Search must work deterministically without an external AI provider.

## 7. Users and Permissions

### 7.1 Dealer

An approved business customer who can:

- Browse and search the catalogue.
- See their eligible prices and discounts.
- Build a cart/order using variants and pack quantities.
- mark individual lines as priority and add product or order notes.
- Save, rename, reopen, and delete order drafts.
- Import order lines from CSV/XLSX.
- Apply valid coupons.
- Request order-level or product-level custom discounts.
- Reorder from an approved request or previous order.
- View order history, status, pending products, dispatch progress, invoices, ledger, and approved discounts.
- View and maintain their permitted profile and shipping information.

### 7.2 Staff

An internal sales or field user who can:

- View only assigned dealers unless granted broader access.
- Review assigned dealer performance, orders, pending products, and credit warnings.
- Submit dealer onboarding requests.
- Manage assigned orders and product-level dispatch when permitted.
- Review discount requests in their scope.
- View dealer ledgers and category reports in their scope.
- Maintain their profile.

### 7.3 Admin

An internal administrator who can:

- Manage dealers, staff, accountants, products, statuses, and assignments.
- Approve or reject dealer and discount requests with notes and audit history.
- Manage all orders, pending orders, product dispatch, content, hot items, and reports.
- Record or correct finance-related data only when granted the corresponding permission.
- Configure catalogue imports, pricing visibility, discount rules, coupons, and operational settings.

### 7.4 Accountant

A finance-focused user who can:

- View orders and pending orders.
- Access order books, dealer ledgers, payments, outstanding balances, invoices, and finance reports.
- Record payments or wallet transactions only if explicitly granted write access.
- Export finance data.
- Have no access to unrelated staff, catalogue, content, or system-administration functions.

### 7.5 Permission Model Requirement

The rebuild must use explicit permissions, not only role names. Example permissions include `catalogue.write`, `orders.read.assigned`, `orders.dispatch`, `discounts.approve`, `ledger.read`, `payments.write`, and `users.manage`. Every API must authorize the authenticated server session before accessing data.

## 8. Current Capability Map and Rebuild Priority

| Domain | Current behavior | Rebuild priority |
| --- | --- | --- |
| Authentication | Shared staff/dealer/admin login via external PHP; separate accountant login | P0 redesign |
| Catalogue | Static JSON catalogue plus a separate admin product API | P0 |
| Product discovery | Header search, product-page search/filter, category pages, dashboard smart search | P0 |
| Product details | Images, features, variants, specs, pack, stock, pricing, related products | P0 |
| Cart/order builder | Variant rows, quantities, discounts, priority, notes, bulk import | P0 |
| Drafts | Named dealer-isolated drafts in MongoDB | P0 |
| Order submission | Sends commercial order data to external PHP API | P0 |
| Discount approvals | Product/order custom requests, approval state, reorder flow | P0 |
| Order history | Search, pagination, status, delete reason, invoice/PDF export | P0 |
| Dispatch | Product-level dispatched/pending quantities and status | P0/P1 |
| Ledger/payments | Dealer balances, transactions, payments, outstanding orders | P0/P1 |
| Wallet | Credits/debits and wallet payment mode | P1 pending policy |
| Dealer management | List, detail, add/request, activate/deactivate, assignment | P1 |
| Staff management | List, add, detail, assignments | P1 |
| Accountant management | Create/list/update/delete accountants | P1 |
| Reports | Dealer-category purchasing and dashboard metrics | P1 |
| Content | Slider images and hot-item merchandising | P2 |
| Rewards | Dealer reward screen exists; business rules need definition | P2/validate |
| AI search | Gemini-assisted intent and routing experiments | P3/optional |

## 9. Core User Journeys

### 9.1 Find and Select a Product

1. User searches by product name, family SKU, variant SKU, category, specification, or feature.
2. Results show product family, category, representative image, price state, stock state, and variant count.
3. User opens the product family page.
4. User compares variants in a stable specification table.
5. User selects a variant and quantity measured in packs.
6. If the price is unavailable, the UI displays `On request` outside the variant table and does not treat zero as a real price.
7. User adds the selection to the order/cart or requests a quote according to business policy.

Acceptance notes:

- Exact SKU searches such as `HMC-AL-15L` and `OM310-020` must succeed.
- Search must normalize case, spaces, punctuation, and catalogue-number separators.
- Category names and aliases such as `Adaptors`/`Adapters` must map to one taxonomy entry.
- Filtering and counts must derive from the same search index and source data.

### 9.2 Build and Submit a Dealer Order

1. Authenticated dealer starts from catalogue, cart, draft, reorder, or bulk import.
2. Each row identifies one immutable product variant SKU.
3. Dealer enters pack quantity, product note, and optional priority flag.
4. Dealer enters shipping address, reference number, and order note.
5. System calculates line gross, base dealer discount, coupon discount, slab/custom discount, tax policy, and final payable amount.
6. Dealer can save a named draft at any point.
7. If a custom discount is needed, dealer submits the relevant order or selected lines for approval. The submitted snapshot is locked and versioned.
8. On approval, dealer reopens the approved snapshot and submits the order without recalculation drift.
9. System creates a durable order, emits an audit event, and returns an order number and confirmation.

### 9.3 Bulk Import

1. Dealer downloads a versioned template.
2. Dealer uploads CSV/XLS/XLSX.
3. Server validates SKU, quantity, pack size, duplicate rows, price state, discontinued products, and authorization.
4. A preview separates accepted rows, warnings, and rejected rows.
5. Dealer confirms before rows are added.
6. Import result is recorded for support and audit.

### 9.4 Discount Approval

1. Dealer requests an order-level percentage or product-level percentages above their current allowed discount.
2. Request stores the complete commercial snapshot, requester, reason, timestamps, and source draft.
3. Admin reviews base discount, requested discount, values, margin context if available, and previous approvals.
4. Admin approves, partially approves, or rejects with a note.
5. Dealer sees status and notification.
6. Approved values are immutable for the approved snapshot and expire according to a defined policy.
7. Rejected requests can create a new editable draft without overwriting the original record.

### 9.5 Fulfillment and Dispatch

1. Operations sees orders awaiting processing.
2. Each order line tracks ordered, allocated, dispatched, cancelled, and pending pack quantities.
3. Staff records dispatch batches with date, carrier, tracking reference, quantity, and actor.
4. System prevents dispatch above remaining quantity.
5. Order status is derived from line state rather than maintained independently in conflicting fields.
6. Dealer sees product-level progress and tracking history.

### 9.6 Ledger and Payment

1. Finance opens a dealer ledger with opening balance, invoices/orders, payments, adjustments, wallet movements, and running balance.
2. Finance records payment mode, amount, date, reference, narration, and supporting evidence if required.
3. Wallet-backed payments use an atomic transaction.
4. Reversals are separate entries; financial records are not silently edited or deleted.
5. Exports reconcile to the same server-calculated totals shown in the UI.

## 10. Catalogue and Pricing Model

### 10.1 Product Family

Required fields:

- Stable internal ID
- Family SKU/catalogue number
- Slug
- Name
- Description and structured feature list
- Primary category ID and additional taxonomy paths
- HSN code
- Images with owned URLs, alt text, sort order, and status
- Publication status
- SEO metadata
- Created/updated/imported timestamps and source version

### 10.2 Variant

Required fields:

- Stable internal ID
- Unique variant SKU
- Parent product ID
- Structured specifications as normalized attribute/value pairs
- Pack size and unit of measure
- Price state: `priced`, `on_request`, or `unavailable`
- Monetary value stored in the smallest currency unit only when state is `priced`
- Currency
- Stock policy and stock status
- Variant images
- Active/discontinued state

Never encode `On request` as numeric zero. Never maintain both an ambiguous numeric price and a free-text price label as competing sources of truth.

### 10.3 Current Catalogue Facts to Migrate

- 1,295 families and 5,125 variants.
- Largest categories include Hydrometers, Filters & Membrane, Thermometers, Plasticware, Adaptors, Distillations, and Lab Instruments.
- Product images currently include third-party search-result URLs. These must be downloaded, rights-checked, optimized, and hosted under Omsons control before launch.
- Category paths and aliases require a migration map and canonical IDs.
- Old `products.json`, `nested_omsons_products.json`, CSV, and generated JSON files must not remain runtime sources after migration.

### 10.4 Pricing Rules

The final PRD must define:

- Whether catalogue prices are per pack or per item.
- Whether prices include GST.
- Dealer-specific base discount source and effective dates.
- Discount stacking order and rounding at each step.
- Slab thresholds and whether they use gross or discounted value.
- Coupon eligibility, expiry, usage limits, and interaction with custom discounts.
- Request-only product behavior in mixed-price orders.
- Price validity for saved drafts and approved discount snapshots.

All monetary calculations must run on the server using integer minor units and a shared calculation module. The server response should include a readable breakdown used by UI, invoices, reports, and ledger posting.

## 11. Search Requirements

Use one shared search service/index for the public header, product listing, dashboard, and order builder.

Searchable fields:

- Family and variant SKU
- Product and variant name
- Category and aliases
- Specification keys and values
- Features and description
- HSN code where permitted

Required behavior:

- Exact SKU matches rank first.
- Prefix and normalized catalogue-number matches rank next.
- Typo tolerance is limited and explainable.
- Facets include category, stock state, price state, and relevant technical attributes.
- Dashboard entity search respects role scope before results are generated.
- Search analytics record anonymized query, result count, selection, and no-result terms.
- AI can optionally interpret natural language, but it may not receive secrets from browser code or bypass deterministic authorization/filtering.

## 12. Information Architecture

### Dealer Storefront

- Home
- Products
- Categories
- Search results
- Product detail
- Cart/order builder
- Drafts
- Discount requests and approvals
- Orders and order detail
- Pending products
- Invoices
- Ledger/wallet
- Profile and addresses

### Staff Workspace

- Dashboard
- Assigned dealers
- Dealer detail
- Dealer onboarding requests
- Assigned orders
- Pending orders/products
- Dispatch
- Discount requests
- Dealer ledger
- Reports
- Profile

### Admin Workspace

- Dashboard
- Dealers and requests
- Staff and assignments
- Catalogue and imports
- Orders, pending products, dispatch
- Discount approvals and pricing rules
- Ledger/payment oversight
- Accountants and permissions
- Reports
- Content merchandising
- Audit log and system health

### Accountant Workspace

- Dashboard
- Order book
- Pending/outstanding orders
- Dealer ledger
- Payments and wallet entries
- Invoices
- Finance exports/reports

The rebuild should remove duplicate route families such as `/Pages/...`, `/dashboard/...`, and `/orders/...` when they represent the same domain. Use lower-case, stable URLs.

## 13. Current Architecture

### 13.1 Runtime Data Sources

| Source | Current ownership |
| --- | --- |
| Static JSON in `public/data` | Storefront catalogue/search, plus some legacy pack-size lookups |
| External PHP service | Main login, dealer/staff/product/order data, order submission and history |
| MongoDB | Drafts, custom discounts, dealer requests/status overrides, order notes/overrides, dispatch overlays, ledgers, wallets, hot items, accountants |
| Supabase | Slider/content storage and some PDF/export behavior |
| Browser local storage | User/session records, role hints, recent state, and client-side authorization inputs |
| Zustand memory state | Cart and product filter state |

### 13.2 Recommended Target Architecture

- One Next.js web application or equivalent frontend backed by a versioned application API.
- One identity provider/session implementation using secure, HTTP-only cookies.
- One relational system of record, preferably PostgreSQL, for users, organizations, permissions, catalogue, prices, orders, approvals, dispatch, ledger references, and audit events.
- Object storage/CDN for product images, imports, invoice PDFs, and attachments.
- Background job queue for imports, exports, notifications, image processing, and sync with any retained ERP/PHP service.
- Search index fed from the canonical catalogue database.
- Server-side integration adapter for any legacy PHP/ERP dependency. Browser code must not call it directly.
- Observability covering structured logs, request IDs, error reporting, uptime checks, slow queries, integration failures, and job status.

Suggested domain modules:

- Identity and access
- Organizations/dealers and staff assignment
- Catalogue and taxonomy
- Pricing and promotions
- Cart, drafts, and quoting
- Orders and approvals
- Fulfillment and dispatch
- Billing, ledger, payments, and wallet
- Content and merchandising
- Reporting and audit

## 14. Key Entities

The detailed schema should include at least:

- User, Session, Role, Permission
- DealerOrganization, DealerContact, Address, StaffAssignment
- Product, ProductVariant, Category, AttributeDefinition, AttributeValue, ProductImage
- PriceList, Price, DealerPriceRule, DiscountRule, Coupon
- Cart, CartLine, Draft, DraftVersion
- DiscountRequest, DiscountDecision
- Order, OrderLine, OrderStatusEvent, OrderNote, ProductNote
- Dispatch, DispatchLine, TrackingEvent
- Invoice, Payment, LedgerEntry, Wallet, WalletEntry
- ImportJob, ImportRowError
- ContentItem, HotItem
- AuditEvent, Notification

All business records should use stable IDs, timestamps, actor IDs, version numbers, and soft-deactivation where history must be preserved.

## 15. API Requirements

- Authenticate every protected endpoint from a server-verified session/token.
- Authorize every object access and mutation against explicit permissions and organization scope.
- Never trust role, actor ID, dealer ID, price, discount, total, or approval state supplied by the browser without verification.
- Validate request and response schemas at runtime.
- Return consistent error envelopes with a request ID and safe user message.
- Use idempotency keys for order submission, payments, wallet changes, imports, and approval decisions.
- Apply rate limits to login, search, export, and mutation endpoints.
- Paginate all unbounded lists.
- Record immutable audit events for sensitive changes.
- Publish an OpenAPI contract and generate typed clients from it.

## 16. Notifications

The rebuild should support in-app notifications first, with email/WhatsApp/SMS added according to business approval.

Events include:

- Dealer request submitted/approved/rejected
- Discount request submitted/approved/rejected/expired
- Order submitted/accepted/status changed
- Product partially dispatched or unavailable
- Invoice available
- Payment recorded or reversed
- Dealer account activated/deactivated
- Import completed with errors

## 17. Reporting and Analytics

Required operational reports:

- Orders by period, dealer, staff, status, and value
- Pending and partially dispatched products
- Dealer-category purchases
- Top products, product families, categories, dealers, and staff
- Discount usage and approval turnaround
- Outstanding and overdue balances
- Payment and wallet movement reconciliation
- Search no-result and low-conversion terms
- Catalogue completeness: missing image, description, HSN, price, category, or specs

Reports must use the same canonical facts as transaction screens. Large exports should run asynchronously and produce a downloadable artifact with an expiry time.

## 18. Non-Functional Requirements

### Security

- Follow OWASP ASVS-aligned controls for authentication, session management, access control, input validation, and audit logging.
- Use HTTP-only, secure, same-site cookies and CSRF protection where applicable.
- Hash passwords using a maintained password library and enforce reset/MFA policy for privileged roles.
- Store secrets only server-side and rotate them.
- Encrypt sensitive data in transit and at rest.
- Conduct dependency scanning, SAST, authorization tests, and a pre-launch penetration test.

### Reliability

- No order, approval, dispatch, payment, or wallet write may be duplicated by retry.
- External integration failures must be queued/retried or surfaced as pending, never silently treated as success.
- Define backup, restore, retention, RPO, and RTO targets.
- Health checks must cover database, storage, queue, search, and retained external integrations.

### Performance

- Do not ship the entire multi-megabyte catalogue to every client.
- Product/search APIs must be paginated and cacheable.
- Optimize images into responsive formats and sizes.
- Set budgets for route JavaScript, Largest Contentful Paint, Interaction to Next Paint, and API latency.
- Avoid loading export/chart libraries until the user opens the relevant feature.

### Accessibility and UX

- Meet WCAG 2.2 AA for keyboard use, focus, labels, contrast, errors, tables, modals, and status updates.
- Responsive support for phone, tablet, and desktop.
- Preserve entered order data during validation and temporary network failures.
- Use consistent terminology for product, variant, pack, unit, order, dispatch, outstanding, and status.

### Quality

- Unit tests for pricing, discounts, totals, status transitions, permission policies, imports, and search normalization.
- Integration tests for every protected API and cross-service transaction.
- Browser tests for login, SKU search, product selection, draft save/reopen, discount approval, order submission, dispatch, and payment.
- A production-build crash test must cover client-reference manifests, chunk loading, key routes, and browser console exceptions.
- CI must run lint, typecheck, unit tests, integration tests, production build, and smoke tests.

## 19. Confirmed Flaws in the Current App

Severity reflects rebuild risk, not a claim that every issue is currently exploited.

### Critical

#### F-01: Client-controlled authentication and authorization

Protected navigation is primarily based on role/user objects in `localStorage`. Multiple server routes trust browser-supplied headers such as `x-omsons-actor-role` and `x-omsons-actor-id`, or accept a `dealer_id` directly without verifying a server session.

Impact: A caller can potentially impersonate a role or access another dealer's object by changing client storage, headers, path values, or query values.

Rebuild requirement: Server-verified identity, permission checks, and object-scope checks on every endpoint. Client guards may improve UX but must never be the security boundary.

#### F-02: Sensitive mutation APIs lack a consistent authorization gate

Examples include accountant management, drafts, wallet adjustments, payment recording, hot-item updates, notes, and other internal mutations. Several handlers validate payload shape but do not establish an authenticated actor.

Impact: Unauthorized data creation, modification, disclosure, or financial manipulation.

Rebuild requirement: Default-deny middleware plus domain-level authorization and audit records. Add automated negative tests for anonymous, wrong-role, and wrong-dealer access.

#### F-03: Hard-coded demo accountant credentials

The accountant auth API contains a working demo email/password path in production source.

Impact: A known credential can create an authenticated finance-role token if deployed unchanged.

Rebuild requirement: Remove all built-in credentials. Seed demo users only in isolated non-production environments.

#### F-04: Browser-exposed AI key path

The smart-search hook reads `NEXT_PUBLIC_GEMINI_API_KEY`, which makes the key available to browser bundles.

Impact: Key extraction, quota theft, unexpected cost, and data-governance risk.

Rebuild requirement: Keep provider credentials server-side, proxy controlled requests, redact business data, rate-limit, and make AI optional.

### High

#### F-05: Multiple competing systems of record

Catalogue and operational truth are split across static JSON, an external PHP service, MongoDB, Supabase, and browser state. There is no visible durable outbox or sync ledger joining those writes.

Impact: Stale prices, mismatched orders, missing notes/overrides, partial writes, difficult reconciliation, and environment-specific failures.

Rebuild requirement: Define one owner per entity and use explicit integration events/jobs for retained external systems.

#### F-06: Catalogue administration is disconnected from storefront catalogue

The storefront uses the new static JSON, while admin product pages use the PHP product API. Updating an admin product does not inherently update the static storefront file.

Impact: Staff can believe a product is updated while dealers still see stale content.

Rebuild requirement: One catalogue database and one publishing workflow with draft/published state and cache invalidation.

#### F-07: Legacy product files remain in live flows

Cart, order detail, and invoice code still fetch `public/data/products.json` for metadata such as pack sizes, while storefront/search uses the new JSON. A report test still imports the old nested catalogue.

Impact: The same SKU can produce different metadata or calculations depending on the screen.

Rebuild requirement: Remove all runtime legacy sources after a validated migration and add a repository check that blocks their reintroduction.

#### F-08: Direct browser dependency on hard-coded production services

Many client pages contain hard-coded `https://mirisoft.co.in/...` and `https://omsonsapp.vercel.app/...` URLs.

Impact: CORS and availability failures, difficult staging, vendor coupling, leaked implementation details, and inconsistent configuration.

Rebuild requirement: Server-side integration adapters and environment-based configuration with startup validation.

#### F-09: Financial and order calculations are duplicated

Pricing, pack-size lookup, discounts, invoice reconciliation, order summaries, ledger amounts, and exports are calculated in several frontend and server modules.

Impact: Rounding drift and disagreements between order screen, invoice, report, and ledger.

Rebuild requirement: One versioned server-side commercial calculation service and immutable calculation snapshots.

#### F-10: Oversized critical screens

The dealer order form is about 152 KB in one file. Order management is about 81 KB, order detail 64 KB, and several dashboards exceed 35-50 KB.

Impact: High regression risk, slow review, difficult testing, excessive client bundles, and intertwined state/effects.

Rebuild requirement: Split by domain/use case, move business rules to tested server/domain modules, and lazy-load heavy tools.

#### F-11: Static catalogue payload and server imports do not scale well

The main catalogue JSON is about 4.3 MB and is repeatedly fetched by clients or imported into route bundles.

Impact: Slow initial loads, memory duplication, large deployments, limited filtering, and cache invalidation problems.

Rebuild requirement: Database-backed paginated catalogue and search APIs, CDN image delivery, and targeted caching.

### Medium

#### F-12: Duplicate navigation and route families

There are overlapping routes under `/Pages`, `/Products`, `/orders`, `/dashboard`, and `/home`, with repeated protected layouts and top bars.

Impact: Inconsistent behavior, duplicated maintenance, confusing URLs, and larger test surface.

Rebuild requirement: One route per user intent and reusable role-aware workspace shells.

#### F-13: Metadata and branding remain inconsistent

Some nested layouts still use `Create Next App` titles/descriptions, and dashboards fetch branding from a deployed external URL despite a local logo asset.

Impact: Poor SEO/browser labels, environment coupling, and inconsistent brand presentation.

Rebuild requirement: Central metadata, local/owned assets, canonical URLs, and page-specific titles.

#### F-14: Third-party and search-result image URLs

Catalogue images include remote search-result URLs rather than a controlled media library.

Impact: Broken images, hotlink blocking, privacy/performance issues, inconsistent quality, and possible usage-rights concerns.

Rebuild requirement: Owned object storage, import-time validation, image derivatives, placeholders, and rights review.

#### F-15: Weak runtime schema discipline

The codebase contains extensive `any`, ad hoc response parsing, field aliases, and status normalization across inconsistent external payloads.

Impact: Data errors appear late in UI code and new backend changes cause silent regressions.

Rebuild requirement: Runtime schemas at every boundary, generated API types, canonical enums, and migration adapters.

#### F-16: Incomplete automated delivery gate

There are useful Node tests and a custom crash smoke test, but `package.json` does not expose a complete unit/integration/browser test pipeline.

Impact: Tests can be skipped unintentionally and browser-only failures may reach deployment.

Rebuild requirement: A single CI test command plus browser tests that execute JavaScript and assert no console/page errors.

#### F-17: Search implementations are duplicated

Header search, product filtering, API search, dashboard entity search, and AI-assisted search use related but separate logic.

Impact: A SKU can work in one search bar and fail in another; ranking and category counts diverge.

Rebuild requirement: One query model and shared indexed search service with role-scoped entity extensions.

#### F-18: Cart durability and ownership are unclear

The primary Zustand cart is in-memory while a separate Mongo-backed draft-cart path exists for handoff to the order form.

Impact: Refreshes, multi-tab use, login changes, and device switching can produce unexpected cart loss or stale rows.

Rebuild requirement: Define guest/authenticated cart behavior, server ownership, expiry, merge rules, and optimistic concurrency.

### Low / Cleanup

#### F-19: Dead or legacy code and dependencies

Examples include legacy page files, local data-generation scripts with machine-specific paths, old comments naming previous JSON files, and dependencies whose active ownership is unclear.

Impact: Larger attack/maintenance surface and developer confusion.

Rebuild requirement: Remove unused routes, files, scripts, and packages after usage analysis.

#### F-20: Debug output and encoding artifacts

There are debug logs in product rendering and visible mojibake/encoding artifacts in comments and some fallback strings.

Impact: Noisy logs and reduced polish/maintainability.

Rebuild requirement: Structured logging, lint rules, UTF-8 normalization, and content QA.

## 20. Rebuild Delivery Plan

### Phase 0: Discovery and Decisions

- Confirm business owner and scope for each current module.
- Decide whether the PHP service is replaced, wrapped, or remains ERP authority.
- Finalize pricing, tax, discount, credit, wallet, cancellation, and dispatch policies.
- Inventory users, dealers, staff assignments, products, orders, financial records, and media.
- Create canonical status and category mappings.
- Threat-model all roles and finance/order mutations.

Exit criteria: approved final PRD, system context diagram, data ownership matrix, migration plan, and acceptance-test plan.

### Phase 1: Secure Foundation

- Identity, sessions, permission model, audit events, environment configuration.
- Canonical dealer/staff/accountant records.
- Database migrations, API conventions, observability, CI/CD, and test harness.
- Legacy integration adapter with contract tests.

### Phase 2: Catalogue and Discovery

- Catalogue import pipeline and validation report.
- Categories/attributes, product management, media migration, price states.
- Product listing, details, facets, deterministic search, and merchandising.
- Redirect map from old product/category URLs.

### Phase 3: Dealer Ordering

- Server-backed cart and drafts.
- Order builder, spreadsheet import preview, notes, priority, addresses.
- Commercial calculation service.
- Discount requests and approval workflow.
- Order submission with idempotency and reconciliation.

### Phase 4: Operations and Finance

- Order management and product-level dispatch.
- Pending-product views and notifications.
- Invoices, ledgers, payments, wallet policy, and finance exports.
- Dealer/staff/accountant administration.

### Phase 5: Reporting, Content, and Cutover

- Reports and catalogue quality dashboards.
- Slider/hot-item tools if still required.
- Parallel data reconciliation, performance test, security review, user acceptance testing.
- Controlled rollout with rollback plan and read-only access to legacy history.

## 21. Proposed MVP

The smallest credible launch should include:

- Secure dealer/admin/staff authentication and server authorization.
- Canonical catalogue import, search, listing, category, and product detail.
- Dealer-specific pricing and request-only price state.
- Cart/order builder, pack quantities, notes, priority, drafts, and CSV/XLSX import preview.
- Base discounts plus custom discount request/approval.
- Idempotent order submission and order history/detail.
- Basic product-level dispatch and pending-product visibility.
- Dealer ledger read view and invoice export if required for launch.
- Admin catalogue, dealer, order, and approval operations.
- Audit log, error monitoring, backups, and automated critical-path tests.

Wallet, rewards, advanced reports, AI search, and content sliders should be included only after their business rules and measurable value are confirmed.

## 22. Launch Acceptance Criteria

- Exact and normalized variant SKU search works from every search surface.
- No protected API accepts an unauthenticated identity or browser-asserted role as authority.
- A dealer cannot read or mutate another dealer's drafts, orders, discounts, ledger, wallet, or profile.
- Admin and finance mutations create immutable audit records.
- Product price state is unambiguous and zero is never rendered as a valid unset price.
- Order totals match invoice and ledger posting for all tested discount combinations.
- Duplicate submission/retry produces one order/payment only.
- Partial dispatch totals cannot exceed ordered quantities.
- Catalogue updates publish predictably without editing deployed JSON files.
- No runtime screen depends on legacy catalogue files or third-party search-result image URLs.
- Key pages pass responsive, accessibility, performance, and browser-console checks.
- CI passes lint, typecheck, unit, integration, build, browser, and crash-smoke suites.
- Migration reconciliation is signed off by product, operations, and finance owners.

## 23. Open Product Decisions

1. Is the target primarily a dealer portal, or should unauthenticated visitors browse products and request quotes?
2. Is the external PHP service an ERP/system of record, or can it be replaced?
3. Which catalogue source is authoritative after launch, and who approves publishing?
4. Are prices per pack, per item, before GST, or after GST?
5. Can request-only variants be ordered, quoted, or only enquired about?
6. What are the exact base, slab, coupon, and custom-discount stacking rules?
7. What approval limits differ by staff/admin level?
8. What is the official order-status and line-status lifecycle?
9. Are cancellation, return, replacement, and credit-note workflows required?
10. Is stock real-time, manually maintained, or informational only?
11. Should wallet functionality remain, and what accounting controls govern it?
12. What is the legal invoice source and numbering authority?
13. Which reports are used for daily decisions versus legacy screens that can be retired?
14. Which notification channels are approved and who owns templates?
15. What historical data must migrate, and what can remain read-only?

## 24. Next Artifacts to Produce

After stakeholders answer the open decisions, create:

- Final PRD with P0/P1 stories and measurable acceptance criteria
- User-flow diagrams and responsive wireframes
- Permission matrix
- Canonical data model and migration mapping
- Pricing/discount calculation examples and test vectors
- Order and dispatch state machines
- API/OpenAPI contract
- Integration and failure-mode design
- Analytics event plan
- Security threat model
- Delivery estimate, milestones, rollout, and rollback plan

## 25. Audit Boundaries

This document is based on repository inspection and local catalogue analysis. It does not include stakeholder interviews, production traffic, database contents, external PHP source code, Supabase policies, deployment settings, legal/tax review, or a penetration test. Any behavior owned by those systems must be validated before the final PRD and migration plan are approved.
