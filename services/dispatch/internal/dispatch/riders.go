package dispatch

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/auth"
)

// RiderAPI is kade.dispatch.v1.RiderService: rider profiles, onboarding and the admin fleet.
type RiderAPI struct {
	dispatchv1.UnimplementedRiderServiceServer
	c *Core
}

func NewRiderAPI(c *Core) *RiderAPI { return &RiderAPI{c: c} }

// DefaultCashLimitMinor is Rs 15,000 (rider app CASH_LIMIT) until ledger says otherwise.
const DefaultCashLimitMinor = 1_500_000

func (a *RiderAPI) GetRiderProfile(ctx context.Context, req *dispatchv1.GetRiderProfileRequest) (*dispatchv1.GetRiderProfileResponse, error) {
	rid, err := a.c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	r, err := loadRider(ctx, a.c.Pool, rid, false)
	if err != nil {
		return nil, err
	}
	return &dispatchv1.GetRiderProfileResponse{Rider: a.c.riderView(ctx, r)}, nil
}

func (a *RiderAPI) GetMyRider(ctx context.Context, _ *dispatchv1.GetMyRiderRequest) (*dispatchv1.GetMyRiderResponse, error) {
	caller := auth.FromContext(ctx)
	if !caller.Authenticated() {
		return nil, errRiderNotFound.With("reason", "x-user-id missing")
	}
	rid, err := a.c.riderForUser(ctx, caller.UserID)
	if err != nil {
		return nil, err
	}
	r, err := loadRider(ctx, a.c.Pool, rid, false)
	if err != nil {
		return nil, err
	}
	return &dispatchv1.GetMyRiderResponse{Rider: a.c.riderView(ctx, r)}, nil
}

func (a *RiderAPI) ListRiderDocuments(ctx context.Context, req *dispatchv1.ListRiderDocumentsRequest) (*dispatchv1.ListRiderDocumentsResponse, error) {
	rid, err := a.c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	r, err := loadRider(ctx, a.c.Pool, rid, false)
	if err != nil {
		return nil, err
	}
	return &dispatchv1.ListRiderDocumentsResponse{Documents: r.R.GetDocuments()}, nil
}

// ---------- onboarding ----------

// docNames are the display names of the rider document kinds.
var docNames = map[string]string{
	"licence": "Driving licence", "revenue": "Revenue licence", "insurance": "Insurance",
	"nicFront": "NIC (front)", "nicBack": "NIC (back)", "nic": "NIC", "police": "Police clearance",
}

func (a *RiderAPI) SubmitRiderApplication(ctx context.Context, req *dispatchv1.SubmitRiderApplicationRequest) (*dispatchv1.SubmitRiderApplicationResponse, error) {
	c := a.c
	name, phone := strings.TrimSpace(req.GetName()), strings.TrimSpace(req.GetPhone())
	if name == "" || digits(phone) == "" {
		return nil, errAppInvalid
	}
	caller := auth.FromContext(ctx)
	resp := &dispatchv1.SubmitRiderApplicationResponse{}
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		key := ""
		if req.GetIdempotencyKey() != "" {
			key = digits(phone) + ":" + req.GetIdempotencyKey()
		}
		hashReq := withoutKey(req, func(r *dispatchv1.SubmitRiderApplicationRequest) { r.IdempotencyKey = "" })
		_, err := once(ctx, tx, "SubmitRiderApplication", key, hashReq, resp, func() error {
			now := c.Now()
			id, _ := uuid.NewV7()
			app := &dispatchv1.RiderApplication{
				Id: id.String(), Name: name, Nic: strings.TrimSpace(req.GetNic()), Phone: phone, City: strings.TrimSpace(req.GetCity()),
				Vehicle: req.GetVehicle(), Lessons: req.GetLessons(), Status: commonv1.ApplicationStatus_APPLICATION_STATUS_PENDING,
				SubmittedAt: ts(now), Bank: maskBank(req.GetBank()),
			}
			if zone := zoneForCity(app.GetCity()); zone != "" {
				app.ZoneIds = []string{zone}
			}
			for _, d := range req.GetDocuments() {
				doc := proto.Clone(d).(*commonv1.PartnerDocument)
				if doc.GetId() == "" {
					did, _ := uuid.NewV7()
					doc.Id = did.String()
				}
				if doc.GetName() == "" {
					doc.Name = docNames[doc.GetKind()]
				}
				doc.Status = commonv1.DocumentStatus_DOCUMENT_STATUS_PENDING
				doc.UploadedAt = ts(now)
				app.Documents = append(app.Documents, doc)
			}
			if err := saveApplication(ctx, tx, app, caller.UserID, req.GetBank().GetAccountNumber()); err != nil {
				return err
			}
			resp.Application = app
			return emitRider(ctx, tx, app.GetId(), &dispatchv1.RiderApplicationSubmitted{ApplicationId: app.GetId(), Application: app, OccurredAt: ts(now)})
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// zoneForCity maps the area a rider typed to a zone ("Kollupitiya" → c03), or "".
func zoneForCity(city string) string {
	c := strings.ToLower(strings.TrimSpace(city))
	if c == "" {
		return ""
	}
	for _, z := range Zones {
		if strings.Contains(c, strings.ToLower(z.Name)) || strings.Contains(c, strings.ToLower(z.Code)) {
			return z.ID
		}
	}
	return ""
}

func maskBank(b *commonv1.BankAccount) *commonv1.BankAccount {
	if b == nil {
		return nil
	}
	out := proto.Clone(b).(*commonv1.BankAccount)
	if n := digits(out.GetAccountNumber()); len(n) >= 4 && out.GetAccountLast4() == "" {
		out.AccountLast4 = n[len(n)-4:]
	}
	out.AccountNumber = ""
	return out
}

func saveApplication(ctx context.Context, db DB, app *dispatchv1.RiderApplication, userID, accountNumber string) error {
	data, err := proto.Marshal(app)
	if err != nil {
		return err
	}
	var uid, acct *string
	if userID != "" {
		uid = &userID
	}
	if accountNumber != "" {
		acct = &accountNumber
	}
	_, err = db.Exec(ctx, `INSERT INTO rider_applications (id, phone, user_id, status, submitted_at, bank_account_number, data)
	  VALUES ($1, $2, $3, $4, $5, $6, $7)
	  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
		app.GetId(), digits(app.GetPhone()), uid, int16(app.GetStatus()), app.GetSubmittedAt().AsTime(), acct, data)
	return err
}

type appRow struct {
	A      *dispatchv1.RiderApplication
	UserID string
}

func loadApplication(ctx context.Context, db DB, id string, lock bool) (*appRow, error) {
	q := `SELECT data, COALESCE(user_id, '') FROM rider_applications WHERE id::text = $1`
	if lock {
		q += ` FOR UPDATE`
	}
	var data []byte
	row := &appRow{A: &dispatchv1.RiderApplication{}}
	if err := db.QueryRow(ctx, q, id).Scan(&data, &row.UserID); err != nil {
		if isNoRows(err) {
			return nil, errAppNotFound.With("application_id", id)
		}
		return nil, err
	}
	return row, proto.Unmarshal(data, row.A)
}

// needsFix is the first rejected document of an application asked for changes.
func needsFix(app *dispatchv1.RiderApplication) *commonv1.PartnerDocument {
	if app.GetStatus() != commonv1.ApplicationStatus_APPLICATION_STATUS_CHANGES_REQUESTED {
		return nil
	}
	for _, d := range app.GetDocuments() {
		if d.GetStatus() == commonv1.DocumentStatus_DOCUMENT_STATUS_REJECTED {
			return d
		}
	}
	return nil
}

func (a *RiderAPI) GetRiderApplicationStatus(ctx context.Context, req *dispatchv1.GetRiderApplicationStatusRequest) (*dispatchv1.GetRiderApplicationStatusResponse, error) {
	var (
		data []byte
		err  error
	)
	if p := digits(req.GetPhone()); p != "" {
		err = a.c.Pool.QueryRow(ctx, `SELECT data FROM rider_applications WHERE phone = $1 ORDER BY submitted_at DESC LIMIT 1`, p).Scan(&data)
	} else if caller := auth.FromContext(ctx); caller.Authenticated() {
		err = a.c.Pool.QueryRow(ctx, `SELECT data FROM rider_applications WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`, caller.UserID).Scan(&data)
	} else {
		return &dispatchv1.GetRiderApplicationStatusResponse{}, nil
	}
	if isNoRows(err) {
		return &dispatchv1.GetRiderApplicationStatusResponse{}, nil
	}
	if err != nil {
		return nil, err
	}
	var app dispatchv1.RiderApplication
	if err := proto.Unmarshal(data, &app); err != nil {
		return nil, err
	}
	return &dispatchv1.GetRiderApplicationStatusResponse{Application: &app, NeedsFix: needsFix(&app)}, nil
}

func (a *RiderAPI) ResubmitRiderDocument(ctx context.Context, req *dispatchv1.ResubmitRiderDocumentRequest) (*dispatchv1.ResubmitRiderDocumentResponse, error) {
	c := a.c
	var out *dispatchv1.RiderApplication
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		row, err := loadApplication(ctx, tx, req.GetApplicationId(), true)
		if err != nil {
			return err
		}
		now := c.Now()
		found := false
		for _, d := range row.A.GetDocuments() {
			if d.GetKind() == req.GetDocumentKind() {
				d.FileName, d.FileRef, d.Status, d.RejectReason, d.UploadedAt = req.GetFileName(), req.GetFileRef(), commonv1.DocumentStatus_DOCUMENT_STATUS_PENDING, "", ts(now)
				found = true
			}
		}
		if !found {
			did, _ := uuid.NewV7()
			row.A.Documents = append(row.A.Documents, &commonv1.PartnerDocument{
				Id: did.String(), Kind: req.GetDocumentKind(), Name: docNames[req.GetDocumentKind()], FileName: req.GetFileName(),
				FileRef: req.GetFileRef(), Status: commonv1.DocumentStatus_DOCUMENT_STATUS_PENDING, UploadedAt: ts(now),
			})
		}
		if row.A.GetStatus() == commonv1.ApplicationStatus_APPLICATION_STATUS_CHANGES_REQUESTED {
			row.A.Status = commonv1.ApplicationStatus_APPLICATION_STATUS_PENDING
		}
		out = row.A
		return saveApplication(ctx, tx, row.A, row.UserID, "")
	})
	if err != nil {
		return nil, err
	}
	return &dispatchv1.ResubmitRiderDocumentResponse{Application: out}, nil
}

// ---------- admin: fleet ----------

func (a *RiderAPI) ListRiders(ctx context.Context, req *dispatchv1.ListRidersRequest) (*dispatchv1.ListRidersResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	var conds []string
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if s := req.GetStatus(); s != dispatchv1.RiderStatus_RIDER_STATUS_UNSPECIFIED {
		conds = append(conds, "status = "+arg(int16(s)))
	}
	if z := req.GetZoneId(); z != "" {
		conds = append(conds, arg(z)+" = ANY(zone_ids)")
	}
	if q := strings.TrimSpace(req.GetQuery()); q != "" {
		p := arg("%" + q + "%")
		conds = append(conds, fmt.Sprintf("(name ILIKE %[1]s OR phone ILIKE %[1]s OR id::text ILIKE %[1]s)", p))
	}
	if req.GetOverCashLimit() {
		conds = append(conds, "cash_held_minor > cash_limit_minor")
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	var total int32
	if err := a.c.Pool.QueryRow(ctx, `SELECT count(*) FROM riders `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	size, offset := clampPage(req.GetPage().GetPageSize(), 100, 500), pageOffset(req.GetPage().GetPageToken())
	rows, err := listRiders(ctx, a.c.Pool, where+fmt.Sprintf(" ORDER BY id LIMIT %d OFFSET %d", size, offset), args...)
	if err != nil {
		return nil, err
	}
	resp := &dispatchv1.ListRidersResponse{Riders: a.c.enrich(ctx, rows), Page: &commonv1.PageResponse{TotalSize: total}}
	if offset+len(rows) < int(total) {
		resp.Page.NextPageToken = fmt.Sprint(offset + len(rows))
	}
	return resp, nil
}

func (a *RiderAPI) GetRider(ctx context.Context, req *dispatchv1.GetRiderRequest) (*dispatchv1.GetRiderResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	r, err := loadRider(ctx, a.c.Pool, req.GetRiderId(), false)
	if err != nil {
		return nil, err
	}
	return &dispatchv1.GetRiderResponse{Rider: a.c.riderView(ctx, r)}, nil
}

func (a *RiderAPI) ListRiderApplications(ctx context.Context, req *dispatchv1.ListRiderApplicationsRequest) (*dispatchv1.ListRiderApplicationsResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	where, args := "", []any{}
	if s := req.GetStatus(); s != commonv1.ApplicationStatus_APPLICATION_STATUS_UNSPECIFIED {
		where, args = "WHERE status = $1", append(args, int16(s))
	}
	var total int32
	if err := a.c.Pool.QueryRow(ctx, `SELECT count(*) FROM rider_applications `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	size, offset := clampPage(req.GetPage().GetPageSize(), 100, 500), pageOffset(req.GetPage().GetPageToken())
	rows, err := a.c.Pool.Query(ctx, `SELECT data FROM rider_applications `+where+fmt.Sprintf(` ORDER BY submitted_at LIMIT %d OFFSET %d`, size, offset), args...)
	if err != nil {
		return nil, err
	}
	datas, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		return nil, err
	}
	resp := &dispatchv1.ListRiderApplicationsResponse{Page: &commonv1.PageResponse{TotalSize: total}}
	for _, b := range datas {
		var app dispatchv1.RiderApplication
		if err := proto.Unmarshal(b, &app); err != nil {
			return nil, err
		}
		resp.Applications = append(resp.Applications, &app)
	}
	if offset+len(datas) < int(total) {
		resp.Page.NextPageToken = fmt.Sprint(offset + len(datas))
	}
	return resp, nil
}

func setDocStatus(docs []*commonv1.PartnerDocument, docID string, st commonv1.DocumentStatus, reason string) bool {
	for _, d := range docs {
		if d.GetId() == docID || d.GetKind() == docID {
			d.Status = st
			d.RejectReason = ""
			if st == commonv1.DocumentStatus_DOCUMENT_STATUS_REJECTED {
				d.RejectReason = reason
			}
			return true
		}
	}
	return false
}

func (a *RiderAPI) ReviewRiderDocument(ctx context.Context, req *dispatchv1.ReviewRiderDocumentRequest) (*dispatchv1.ReviewRiderDocumentResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	c := a.c
	var docs []*commonv1.PartnerDocument
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		if req.GetApplicationId() != "" {
			row, err := loadApplication(ctx, tx, req.GetApplicationId(), true)
			if err != nil {
				return err
			}
			if !setDocStatus(row.A.GetDocuments(), req.GetDocumentId(), req.GetStatus(), req.GetRejectReason()) {
				return errDocNotFound.With("document_id", req.GetDocumentId())
			}
			// A rejected document sends the application back to the applicant ("needs a fix").
			if req.GetStatus() == commonv1.DocumentStatus_DOCUMENT_STATUS_REJECTED &&
				row.A.GetStatus() == commonv1.ApplicationStatus_APPLICATION_STATUS_PENDING {
				row.A.Status = commonv1.ApplicationStatus_APPLICATION_STATUS_CHANGES_REQUESTED
				row.A.DecisionNote = req.GetRejectReason()
			}
			docs = row.A.GetDocuments()
			return saveApplication(ctx, tx, row.A, row.UserID, "")
		}
		r, err := loadRider(ctx, tx, req.GetRiderId(), true)
		if err != nil {
			return err
		}
		if !setDocStatus(r.R.GetDocuments(), req.GetDocumentId(), req.GetStatus(), req.GetRejectReason()) {
			return errDocNotFound.With("document_id", req.GetDocumentId())
		}
		docs = r.R.GetDocuments()
		return saveRider(ctx, tx, r, false)
	})
	if err != nil {
		return nil, err
	}
	return &dispatchv1.ReviewRiderDocumentResponse{Documents: docs}, nil
}

func (a *RiderAPI) DecideRiderApplication(ctx context.Context, req *dispatchv1.DecideRiderApplicationRequest) (*dispatchv1.DecideRiderApplicationResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	switch req.GetDecision() {
	case commonv1.ApplicationStatus_APPLICATION_STATUS_APPROVED, commonv1.ApplicationStatus_APPLICATION_STATUS_CHANGES_REQUESTED,
		commonv1.ApplicationStatus_APPLICATION_STATUS_REJECTED:
	default:
		return nil, errDecisionInvalid
	}
	c := a.c
	resp := &dispatchv1.DecideRiderApplicationResponse{}
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		key := ""
		if req.GetIdempotencyKey() != "" {
			key = req.GetApplicationId() + ":" + req.GetIdempotencyKey()
		}
		hashReq := withoutKey(req, func(r *dispatchv1.DecideRiderApplicationRequest) { r.IdempotencyKey = "" })
		_, err := once(ctx, tx, "DecideRiderApplication", key, hashReq, resp, func() error {
			row, err := loadApplication(ctx, tx, req.GetApplicationId(), true)
			if err != nil {
				return err
			}
			app := row.A
			switch app.GetStatus() {
			case commonv1.ApplicationStatus_APPLICATION_STATUS_APPROVED, commonv1.ApplicationStatus_APPLICATION_STATUS_REJECTED:
				return errAppDecided
			}
			now := c.Now()
			if req.GetDecision() == commonv1.ApplicationStatus_APPLICATION_STATUS_APPROVED {
				for _, d := range app.GetDocuments() {
					if d.GetStatus() != commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED && d.GetStatus() != commonv1.DocumentStatus_DOCUMENT_STATUS_EXPIRING {
						return errDocsNotApproved.With("document", d.GetKind())
					}
				}
				rider, err := c.riderFromApplication(ctx, tx, row, now)
				if err != nil {
					return err
				}
				app.RiderId = rider.GetId()
			}
			app.Status = req.GetDecision()
			app.DecisionNote = req.GetNote()
			app.DecidedAt = ts(now)
			if err := saveApplication(ctx, tx, app, row.UserID, ""); err != nil {
				return err
			}
			resp.Application = app
			return emitRider(ctx, tx, app.GetId(), &dispatchv1.RiderApplicationDecided{ApplicationId: app.GetId(), Application: app, Actor: actor(ctx), OccurredAt: ts(now)})
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// riderFromApplication creates the rider record of an approved application (OFFLINE).
func (c *Core) riderFromApplication(ctx context.Context, tx pgx.Tx, row *appRow, now time.Time) (*dispatchv1.Rider, error) {
	app := row.A
	id, _ := uuid.NewV7()
	zones := app.GetZoneIds()
	if len(zones) == 0 {
		zones = []string{"c03"}
	}
	r := &dispatchv1.Rider{
		Id: id.String(), Name: app.GetName(), FirstName: firstName(app.GetName()), Phone: app.GetPhone(),
		MaskedPhone: maskedPhone("4", id.String()), Vehicle: &dispatchv1.Vehicle{Type: app.GetVehicle()},
		Status: dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE, ZoneIds: zones, Rating: 5, AcceptanceRate: 1,
		CashHeld: lkr(0), CashLimit: lkr(DefaultCashLimitMinor), CashAllowed: true, JoinedAt: ts(now), Bank: app.GetBank(),
		DepositReference: fmt.Sprintf("KR-%s-%s", strings.ToUpper(id.String()[len(id.String())-4:]), initials(app.GetName())),
		Documents:        app.GetDocuments(), UserId: row.UserID,
	}
	if row.UserID != "" {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM riders WHERE user_id = $1)`, row.UserID).Scan(&taken); err != nil {
			return nil, err
		}
		if taken {
			r.UserId = "" // that login already has a rider record
		}
	}
	if err := saveRider(ctx, tx, &RiderRow{R: r}, false); err != nil {
		return nil, err
	}
	return r, nil
}

func initials(name string) string {
	var b strings.Builder
	for _, f := range strings.Fields(name) {
		b.WriteString(strings.ToUpper(f[:1]))
	}
	return b.String()
}

func (a *RiderAPI) SetRiderZones(ctx context.Context, req *dispatchv1.SetRiderZonesRequest) (*dispatchv1.SetRiderZonesResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	var zones []string
	for _, z := range req.GetZoneIds() {
		if _, ok := ZoneByID(z); !ok {
			return nil, errZoneUnknown.With("zone_id", z)
		}
		if !slices.Contains(zones, z) {
			zones = append(zones, z)
		}
	}
	if len(zones) == 0 {
		return nil, errZonesRequired
	}
	c := a.c
	var row *RiderRow
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		r, err := loadRider(ctx, tx, req.GetRiderId(), true)
		if err != nil {
			return err
		}
		r.R.ZoneIds = zones
		row = r
		if err := saveRider(ctx, tx, r, false); err != nil {
			return err
		}
		now := c.Now()
		return emitRider(ctx, tx, r.R.GetId(), &dispatchv1.RiderStatusChanged{
			RiderId: r.R.GetId(), Status: r.R.GetStatus(), Previous: r.R.GetStatus(), Reason: "zones changed", ZoneIds: zones,
			Actor: actor(ctx), OccurredAt: ts(now),
		})
	})
	if err != nil {
		return nil, err
	}
	return &dispatchv1.SetRiderZonesResponse{Rider: c.riderView(ctx, row)}, nil
}

func (a *RiderAPI) SetRiderSuspended(ctx context.Context, req *dispatchv1.SetRiderSuspendedRequest) (*dispatchv1.SetRiderSuspendedResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	c := a.c
	var row *RiderRow
	var rematch bool
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		r, err := loadRider(ctx, tx, req.GetRiderId(), true)
		if err != nil {
			return err
		}
		row = r
		now := c.Now()
		if req.GetSuspended() {
			n, err := c.withdrawRiderOffer(ctx, tx, r.R.GetId(), now)
			if err != nil {
				return err
			}
			rematch = n > 0
			return c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED, strings.TrimSpace(req.GetReason()), now)
		}
		if r.R.GetStatus() != dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED {
			return nil
		}
		return c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE, "", now)
	})
	if err != nil {
		return nil, err
	}
	if req.GetSuspended() {
		_ = c.Fleet.MakeUnavailable(ctx, row.R.GetId())
	}
	if rematch {
		c.Wake()
	}
	return &dispatchv1.SetRiderSuspendedResponse{Rider: c.riderView(ctx, row)}, nil
}
