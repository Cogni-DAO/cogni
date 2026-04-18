---
id: poly-wallet-screen-ranking
type: research
title: "Polymarket wallet screen — resolved-outcome ranking (140-wallet universe)"
status: active
trust: draft
summary: "Raw markdown output of scripts/experiments/wallet-screen-resolved.ts — 16 wallets passing the full filter set, plus top-20 by realized PnL regardless of filters with per-filter fail reasons."
read_when: Reviewing the data-backed candidate shortlist for the poly copy-trade paper mirror.
owner: derekg1729
created: 2026-04-18
verified: 2026-04-18
tags: [polymarket, copy-trading, wallet-selection, screen-output]
---

## Screen results — 140-wallet universe → 16 pass all filters

**Filters:** ≥1 trades/day · active ≤5d · ≥15 resolved posns · win rate ≥52% · ROI ≥10% · median dur ≤9h · max DD ≤40% of peak

| rank | wallet        | name             | cat     | t/day | resolved |        WR |    ROI | realized PnL | max DD% | med dur | top market                           |
| ---: | ------------- | ---------------- | ------- | ----: | -------: | --------: | -----: | -----------: | ------: | ------: | ------------------------------------ |
|    1 | `0x6d3c5bd1…` | VeryLucky888     | nba     | 16.67 |       33 | **78.8%** |  1033% |         $33k |    4.9% |    0.2h | Spread: Nuggets (-6.5)               |
|    2 | `0xc69020e5…` | goodmateng       | esports | 10.33 |       22 | **95.5%** | 245.4% |        $356k |    6.9% |    0.7h | Counter-Strike: FURIA vs Vitality (B |
|    3 | `0x161eb168…` | piston777        | esports | 16.67 |       43 |   **86%** |  19.5% |        $151k |    2.2% |    0.2h | LoL: Weibo Gaming vs JD Gaming (BO3) |
|    4 | `0x26f8af9d…` | Mr.Ape           | esports |  11.2 |       75 |   **64%** |   135% |        $114k |   14.5% |    0.4h | Dota 2: Team Yandex vs Team Falcons  |
|    5 | `0x36257cb6…` | 0x36257cb65f199c | nba     |   9.9 |       37 | **54.1%** |  60.1% |        $406k |    6.6% |    0.7h | Timberwolves vs. Nuggets: O/U 230.5  |
|    6 | `0xa5ea13a8…` | bossoskil1       | esports |  15.9 |       64 | **60.9%** |  69.9% |        $841k |   24.9% |    0.9h | LoL: GIANTX vs Natus Vincere - Game  |
|    7 | `0x52ecea7b…` | fkgggg2mouzfuria | esports | 16.67 |       51 | **52.9%** |  16.7% |        $109k |    9.2% |    0.1h | LoL: G2 Esports vs SK Gaming (BO3) - |
|    8 | `0x492442ea…` | 0x492442EaB586F2 | nba     | 16.67 |       39 | **64.1%** |  43.3% |       $1171k |   28.1% |    0.1h | Spread: Clippers (-4.5)              |
|    9 | `0x32ed517a…` | sportmaster777   | nba     | 16.67 |       96 | **55.2%** |  27.8% |         $31k |   18.3% |      1h | Spread: Cavaliers (-19.5)            |
|   10 | `0x5c3a1a60…` | VARsenal         | esports |   3.9 |       66 | **65.2%** |  32.4% |        $100k |   26.1% |    0.7h | Will Club Atlético de Madrid win on  |
|   11 | `0x7a8885c8…` | stackingsats     | mlb     |  6.43 |       30 |   **70%** |  33.6% |         $97k |   31.4% |    0.2h | Warriors vs. Suns                    |
|   12 | `0x57cd9399…` | Supah9ga         | esports |   4.9 |       46 | **60.9%** |  27.6% |        $114k |   27.9% |    0.5h | Will Chelsea FC win on 2026-04-18?   |
|   13 | `0x6ade597c…` | TheOnlyHuman     | nba     | 16.67 |       82 | **58.5%** |  19.5% |        $162k |   23.6% |    0.5h | Spread: Rockets (-4.5)               |
|   14 | `0x63a51cbb…` | noMoohyun523     | mlb     | 16.67 |       15 | **53.3%** |  30.1% |        $822k |     31% |    0.9h | Warriors vs. Suns                    |
|   15 | `0xe934f2d7…` | Feveey           | nba     |  2.53 |       39 | **53.8%** |  24.2% |        $849k |   30.7% |    0.1h | Hornets vs. Magic: O/U 218.5         |
|   16 | `0xea2b4224…` | Bethooven        | esports |  3.63 |       93 | **63.4%** |  23.2% |        $110k |     37% |    0.1h | Will Manchester United FC win on 202 |

## Excluded-but-notable — top 20 by realized PnL regardless of filters

| wallet        | cat         | t/day | resolved |    WR |     ROI | realized PnL |    DD% | med dur | notes                           |
| ------------- | ----------- | ----: | -------: | ----: | ------: | -----------: | -----: | ------: | ------------------------------- |
| `0xc2e7800b…` | nba         |  7.03 |       33 | 60.6% |    9.5% |       $2544k | 165.3% |    0.3h | cold(5.8d),roi(9.5%),dd(165.3%) |
| `0x492442ea…` | nba         | 16.67 |       39 | 64.1% |   43.3% |       $1171k |  28.1% |    0.1h | ✅ passes                       |
| `0xe90bec87…` | nba         |     0 |       36 | 52.8% |   90.7% |        $955k |  23.7% |    1.3h | slow,cold(47.1d)                |
| `0xe934f2d7…` | nba         |  2.53 |       39 | 53.8% |   24.2% |        $849k |  30.7% |    0.1h | ✅ passes                       |
| `0xa5ea13a8…` | esports     |  15.9 |       64 | 60.9% |   69.9% |        $841k |  24.9% |    0.9h | ✅ passes                       |
| `0x63a51cbb…` | mlb         | 16.67 |       15 | 53.3% |   30.1% |        $822k |    31% |    0.9h | ✅ passes                       |
| `0x8c80d213…` | geopolitics |   2.2 |       16 | 31.3% |    108% |        $700k |   4.6% |   16.4h | wr(31.3%),dur(16.4h)            |
| `0xc8075693…` | nba         | 16.67 |       59 | 55.9% |   33.4% |        $556k |  44.3% |    0.1h | dd(44.3%)                       |
| `0xc6587b11…` | geopolitics |  4.33 |       14 | 71.4% |   53.6% |        $554k |   8.7% |   64.8h | low-n(14),dur(64.8h)            |
| `0xdb27bf2a…` | nba         |   2.9 |       60 |   40% |   25.9% |        $543k |    42% |    0.3h | wr(40%),dd(42%)                 |
| `0xf195721a…` | nhl         |  2.67 |       21 | 57.1% |   28.6% |        $505k |  32.2% |    0.4h | cold(11.6d)                     |
| `0x36257cb6…` | nba         |   9.9 |       37 | 54.1% |   60.1% |        $406k |   6.6% |    0.7h | ✅ passes                       |
| `0xc69020e5…` | esports     | 10.33 |       22 | 95.5% |  245.4% |        $356k |   6.9% |    0.7h | ✅ passes                       |
| `0x03e8a544…` | nhl         | 15.33 |       34 | 47.1% |   22.9% |        $308k |  83.9% |    1.6h | wr(47.1%),dd(83.9%)             |
| `0xde7be6d4…` | geopolitics | 10.73 |       10 |   50% |   68.2% |        $255k |  14.2% |  310.8h | low-n(10),wr(50%),dur(310.8h)   |
| `0xfc25f141…` | nba         | 16.67 |       93 | 65.6% |   51.9% |        $247k |   0.5% |      0h | dur(0h)                         |
| `0xa71093ca…` | nba         | 13.83 |       77 | 49.4% |   19.8% |        $239k |  73.9% |    2.4h | wr(49.4%),dd(73.9%)             |
| `0x8a3ab812…` | nba         |  4.47 |       31 | 74.2% |   45.8% |        $236k |  16.5% |      1h | cold(5.9d)                      |
| `0x2b3ff45c…` | nba         |   7.6 |        8 | 87.5% |   51.1% |        $208k |  62.1% |    2.9h | cold(9.1d),low-n(8),dd(62.1%)   |
| `0xfea31bc0…` | soccer      | 16.67 |        6 | 66.7% | 2890.2% |        $203k |   1.1% |    0.1h | low-n(6)                        |
