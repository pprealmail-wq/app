# Demo data (made up)

`products_demo.xlsx` / `.csv` is a made-up product list, not the store's real stock list.
- 972 real products seen in the sales files of 28 Sep to 3 Oct 2026, with `on_hand` = the POS opening balance before 28 Sep.
- 61 invented slow movers (codes `D0001` to `D0061`), same categories and units, never sold.
- Prices: real where the POS had one, otherwise invented.

Two demo routes (both end with the same stock):
1. Upload `products_demo.xlsx` first, then the daily files in date order.
2. Skip the list and upload only the daily files.

The daily POS files are customer data and are not in this repository.
