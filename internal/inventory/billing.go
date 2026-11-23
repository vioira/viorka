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
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
}

var decimalPrice = regexp.MustCompile(`^[0-9]{1,19}(\.[0-9]{1,2})?$`)

func (v BillingUpdate) MinorUnits() (*int64, error) {
	if t := v.ExpiresAt; t != nil && (t.UTC().Year() < 1 || t.UTC().Year() > 9999 || t.Second() != 0 || t.Nanosecond() != 0) {
		return nil, auth.ErrInvalid
	}
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
