# Data Dictionary

## `sku_performance.csv`

- `product_id`: synthetic customer SKU ID.
- `product_name`, `brand`, `category`, `subcategory`: product descriptors.
- `shade_group`: commercial color family.
- `seasonality`: `Evergreen`, `Winter`, or `Summer`.
- `status`: `aktiv` or `inaktiv` customer assortment status.
- `stock_status`: `in_stock`, `low_stock`, or `out_of_stock`.
- `private_label`: whether the SKU is customer private label.
- `price_eur`, `pack_size`, `attributes`: sell price and product metadata.
- `channel_revenue_eur_12w`, `channel_units_sold_12w`, `channel_margin_pct`, `channel_sales_trend_12w_pct`: customer-channel performance over the last 12 weeks.
- `market_revenue_eur_12w`, `market_units_sold_12w`, `market_sales_trend_12w_pct`: wider-market demand proxy over the same period.

## `product_metadata.csv`

Includes the product descriptors above plus:

- `launch_season`: synthetic launch period.
- `shelf_space_cm`: approximate shelf allocation.
- `supplier`: supplier / distributor name.
- `ean`: synthetic EAN-like identifier.

## `competitor_market_signals.csv`

- `competitor_product_id`, `competitor_product_name`, `brand`, `category`, `subcategory`, `shade_group`: competitor/market product descriptors.
- `price_eur`: observed competitor price.
- `rank_or_popularity_signal`: lower rank means stronger position where the source is rank-based.
- `signal_score_0_100`: normalized popularity score.
- `source`: source of the signal.
- `trend_score_12w_pct`: estimated recent trend.
- `observed_date`: observation date.
