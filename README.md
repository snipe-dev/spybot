# _SPYBOT — EVM Wallet Transaction Monitor

<p align="center">
  <img src="https://raw.githubusercontent.com/snipe-dev/spybot/master/src/assets/logo.png" width="320" alt="Spybot Logo" />
</p>

<p align="center">
  <strong>Full working Telegram bot available:</strong><br />
  <a href="https://t.me/ETH_SPYBOT">@ETH_SPYBOT</a><br />
  <strong>[ Ethereum Wallet Tracker Bot ]</strong>

</p>
<p align="center">
  <a href="https://t.me/BSC_SPYBOT">@BSC_SPYBOT</a><br />
  <strong>[ BSC Wallet Tracker Bot ]</strong>
</p>

------------------------------------------------------------------------

SpyBot is a high-performance Telegram bot for real-time monitoring of
wallet activity across **EVM-compatible blockchains**.

Designed as a production-ready infrastructure component for real-time
wallet monitoring.

It tracks all wallet transactions, including internal calls, and sends
structured notifications for swaps, transfers, contract interactions,
deployments, and other on-chain events. The system can identify token
contracts from sniper/spam transactions and decode complex or failed
transactions using debug RPC nodes.

------------------------------------------------------------------------

## 🚀 Features

-   Full wallet transaction monitoring (including internal transactions)
-   Real-time notifications for all transaction types
-   Token identification from sniper and spam activity
-   Advanced transaction decoding via debug RPC nodes
-   Support for any EVM-compatible network
-   Unlimited watchlist addresses
-   RPC load reduction via intelligent caching
-   Fault-tolerant multi-node RPC client

------------------------------------------------------------------------

## 🔄 Data Flow

1.  BlockReader polls new blocks.
2.  MultinodePublicClient ensures RPC fault tolerance.
3.  TransactionProcessor filters transactions using user watchlists.
4.  OptimizedTracer decodes transactions.
5.  MessageBuilder formats readable notifications.
6.  TelegramQueue guarantees ordered delivery with rate-limit handling.
7.  TelegramBot processes commands and manages watchlists.

------------------------------------------------------------------------

## 🏗 Architecture Overview

SpyBot follows a layered, event-driven architecture designed for
low-latency processing and fault tolerance.

Core layers:

-   **Transport Layer**
    -   MultinodePublicClient
    -   BlockReader
    -   Provides normalized blocks and transactions
-   **Processing Layer**
    -   TransactionProcessor
    -   Watchlist filtering
    -   Deduplication
    -   Fast / Full decoding pipeline
-   **Decoding Layer**
    -   OptimizedTracer
    -   Internal call tracing
    -   debug_traceTransaction support
-   **Presentation Layer**
    -   MessageBuilder
    -   Deterministic message formatting
    -   Idempotent message updates
-   **Delivery Layer**
    -   TelegramQueue
    -   Ordered delivery
    -   Rate-limit handling
    -   Retry logic

All upper layers operate on normalized transaction data, making the
system chain-agnostic for EVM-compatible networks.

------------------------------------------------------------------------

## 📐 Design Decisions

-   **Fast-first decoding strategy**\
    Fast decoding is executed before full trace analysis to minimize
    user-facing latency.

-   **Multinode RPC consensus**\
    Reduces risk of inconsistent block data from unreliable RPC nodes.

-   **Idempotent message updates**\
    Messages are first sent in "fast" mode and later updated with full
    trace data, avoiding duplicate notifications.

-   **Bounded deduplication**\
    Deduplication uses a fixed-size sliding window to prevent unbounded
    memory growth.

-   **Separation of concerns**\
    Transport, decoding, processing, and delivery are strictly isolated
    to allow independent scaling and replacement.

------------------------------------------------------------------------

## ⚠️ Limitations

-   Full transaction decoding requires RPC nodes that support
    `debug_traceTransaction`.

-   Deep chain reorganizations are not fully replayed.

-   Telegram rate limits may delay message updates under extreme load.

-   RPC nodes with inconsistent data may temporarily affect decoding
    accuracy if consensus thresholds are not met.

------------------------------------------------------------------------

## 🧪 Testing

Unit and integration tests are located in:

    src/tests

Run tests:

``` bash
npm test
```

Test coverage includes:

-   Multinode RPC consensus logic
-   Transaction decoding pipeline
-   Message formatting
-   Deduplication logic

------------------------------------------------------------------------

## 🏭 Production Considerations

-   Handles RPC node inconsistencies
-   Supports horizontal scaling
-   Stateless processing per block
-   Memory-bounded deduplication
-   Backpressure-safe Telegram delivery
-   Suitable for high-volume wallet monitoring

Designed for infrastructure-level monitoring workloads.

------------------------------------------------------------------------

## 🛠 Technology Stack

-   TypeScript
-   viem
-   grammy
-   MySQL
-   SQLite (better-sqlite3)
-   eventemitter3

------------------------------------------------------------------------

## ⚙️ Requirements

-   Node.js 18+
-   MySQL
-   RPC endpoints (EVM networks)
-   Telegram Bot Token

------------------------------------------------------------------------

## 🚀 Installation

``` bash
npm install
npm start
```
