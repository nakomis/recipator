# Recipator — Extract and save recipes from the web with AI

<p align="center">
  <img src="assets/icon-1024.png" alt="Recipator" width="200" />
</p>

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=recipator)

## Table of Contents

<!-- toc -->

- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [Repository Layout](#repository-layout)
- [Stack](#stack)
- [Getting Started](#getting-started)
  * [Prerequisites](#prerequisites)
  * [Setup](#setup)
  * [Architecture Diagrams](#architecture-diagrams)
- [Support](#support)

<!-- tocstop -->

## Overview

Recipator lets you share any recipe URL from Chrome on iPhone, iPad, or desktop and save it as a clean Markdown file — ingredients and method, no adverts, no life stories. It extracts structured data (schema.org/Recipe) when available, and falls back to Claude Haiku for everything else.

## Architecture Diagram

![Architecture](docs/architecture/recipator.svg)

## Repository Layout

| Directory | Contents |
|---|---|
| `Recipator/` | iOS SwiftUI app — recipe list and viewer |
| `RecipatorShare/` | iOS Share Extension — receives URLs from the share sheet |
| `Shared/` | Swift code shared between app and extension |
| `RecipatorTests/` | XCTest unit tests |
| `assets/` | App icon and design assets |
| `docs/architecture/` | draw.io architecture diagram and generated SVG |

## Stack

- **iOS app + Share Extension** — Swift 5.10, SwiftUI, iOS 17+
- **Recipe extraction** — schema.org/Recipe JSON-LD first; Claude Haiku fallback
- **Storage** — App Group shared container (local `.md` files), AWS backend planned
- **Desktop** — Chrome extension (planned)

## Getting Started

### Prerequisites

- Xcode 15+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
git clone git@github.com:nakomis/recipator.git
cd recipator
cp Shared/Secrets.swift.example Shared/Secrets.swift
# Edit Shared/Secrets.swift and fill in your Anthropic API key
xcodegen generate
open Recipator.xcodeproj
```

Plug in a device, select it as the destination, and run. The Share Extension will appear in Chrome's share sheet once the app is installed.

### Architecture Diagrams

`docs/architecture/recipator.drawio` is the source for the diagram above.
The SVG is auto-regenerated on commit by the pre-commit hook in `.githooks/pre-commit`.

To activate the hook after cloning:

```bash
git config core.hooksPath .githooks
```

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=recipator)
