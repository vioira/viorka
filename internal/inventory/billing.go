package inventory

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

// Billing represents the total price per period, independently of the rental expiry.
type Billing struct {
	Revision     int64   `json:"revision" minimum:"1"`
	Price        *string `json:"price,omitempty" doc:"Exact decimal total for the entire period."`
	Currency     string  `json:"currency,omitempty" enum:"CNY,USD,EUR,JPY"`
	PeriodMonths *int    `json:"period_months,omitempty" enum:"1,3,6,24,36,48,60"`
	ExpiresAt    *string `json:"expires_at,omitempty" format:"date-time"`
}
type BillingUpdate struct {
	ExpectedRevision int64      `json:"expected_revision" minimum:"1"`
	Price            *string    `json:"price,omitempty" maxLength:"22"`
	Currency         string     `json:"currency,omitempty" enum:"CNY,USD,EUR,JPY"`
	PeriodMonths     *int       `json:"period_months,omitempty" enum:"1,3,6,24,36,48,60"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty" doc:"Legacy explicit expiry, precise to the minute."`
	ExpiresOn        *string    `json:"expires_on,omitempty" format:"date" doc:"Rental expiry date. Resolved at 23:59:59 in time_zone."`
	TimeZone         string     `json:"time_zone,omitempty" maxLength:"128" doc:"IANA time zone for expires_on."`
	KeepExpiry       bool       `json:"keep_expiry,omitempty" doc:"Preserve the stored instant when updating fees only."`
}

var decimalPrice = regexp.MustCompile(`^[0-9]{1,19}(\.[0-9]{1,2})?$`)

func (v BillingUpdate) ExpiryInstant() (*time.Time, error) {
	if v.ExpiresOn == nil {
		if v.TimeZone != "" || (v.KeepExpiry && v.ExpiresAt != nil) {
			return nil, auth.ErrInvalid
		}
		if t := v.ExpiresAt; t != nil && (t.UTC().Year() < 1 || t.UTC().Year() > 9999 || t.Second() != 0 || t.Nanosecond() != 0) {
			return nil, auth.ErrInvalid
		}
		return v.ExpiresAt, nil
	}
	if v.KeepExpiry || v.ExpiresAt != nil || v.TimeZone == "" || v.TimeZone == "Local" || len(v.TimeZone) > 128 {
		return nil, auth.ErrInvalid
	}
	loc, err := time.LoadLocation(v.TimeZone)
	if err != nil {
		return nil, auth.ErrInvalid
	}
	date, err := time.Parse(time.DateOnly, *v.ExpiresOn)
	if err != nil || date.Year() < 1 {
		return nil, auth.ErrInvalid
	}
	end := time.Date(date.Year(), date.Month(), date.Day(), 23, 59, 59, 0, loc)
	// When the final hour repeats, the rental includes its second occurrence.
	if _, transition := end.ZoneBounds(); !transition.IsZero() {
		_, offset := end.Zone()
		_, nextOffset := transition.Zone()
		if offset > nextOffset {
			later := end.Add(time.Duration(offset-nextOffset) * time.Second)
			if later.Format(time.DateTime) == end.Format(time.DateTime) {
				end = later
			}
		}
	}
	if end.Format(time.DateTime) != *v.ExpiresOn+" 23:59:59" || end.UTC().Year() < 1 || end.UTC().Year() > 9999 {
		return nil, auth.ErrInvalid
	}
	return &end, nil
}

func (v BillingUpdate) MinorUnits() (*int64, error) {
	if v.ExpectedRevision < 1 {
		return nil, auth.ErrInvalid
	}
	if v.Price == nil {
		if v.Currency != "" || v.PeriodMonths != nil {
			return nil, auth.ErrInvalid
		}
		return nil, nil
	}
	if v.PeriodMonths == nil || !decimalPrice.MatchString(*v.Price) {
		return nil, auth.ErrInvalid
	}
	switch *v.PeriodMonths {
	case 1, 3, 6, 24, 36, 48, 60:
	default:
		return nil, auth.ErrInvalid
	}
	whole, fraction, dot := strings.Cut(*v.Price, ".")
	switch v.Currency {
	case "JPY":
		if dot {
			return nil, auth.ErrInvalid
		}
	case "CNY", "USD", "EUR":
		fraction += strings.Repeat("0", 2-len(fraction))
	default:
		return nil, auth.ErrInvalid
	}
	minor, err := strconv.ParseInt(whole+fraction, 10, 64)
	if err != nil {
		return nil, auth.ErrInvalid
	}
	return &minor, nil
}

func (b *Billing) SetMinorUnits(minor *int64) {
	if minor == nil {
		b.Price = nil
		return
	}
	price := strconv.FormatInt(*minor, 10)
	if b.Currency != "JPY" {
		price = strconv.FormatInt(*minor/100, 10)
		if rest := *minor % 100; rest != 0 {
			price += strings.TrimRight(fmt.Sprintf(".%02d", rest), "0")
		}
	}
	b.Price = &price
}
