---
title: Desktop Test Windows Cover The Screen Without Taking Focus
date: 2026-10-29
category: test-failures
module: Roughdraft desktop (Electron)
problem_type: test_side_effect
component: tooling
symptoms:
  - "Running the Electron specs put Roughdraft windows in front of whatever app the person was using"
  - "The frontmost app never changed, so the earlier fix looked as if it worked"
root_cause: platform_behaviour
resolution_type: code_fix
severity: medium
tags: [electron, macos, e2e, playwright, focus, background]
---

# Desktop Test Windows Cover The Screen Without Taking Focus

## Problem

`ROUGHDRAFT_DESKTOP_BACKGROUND=1`, which `packages/app/playwright.config.ts` sets, made test windows open with `showInactive()` and the app run with the `accessory` activation policy. Keyboard focus stayed with the person's app, but the test windows still appeared on top of everything during `pnpm test:e2e`, `pnpm test:smoke` and any `desktop-*` spec.

## Root cause

On macOS, Electron's `showInactive()` orders the window in front of every other app's windows (`orderFrontRegardless`). It does not make the app active, so `lsappinfo front` and `NSWorkspace.frontmostApplication` never change. A check on the frontmost app alone therefore cannot catch this.

The alternatives each fail in a different way:

- Never showing the window: renderer input stops working. Clicks dispatched by Playwright do nothing, and quitting then fails because the window cannot report itself ready to close. That raises the "could not safely close" message box, and the sheet shows the window anyway.
- Moving the window off-screen: macOS pulls it back so that part of the window stays visible, both when the window is ordered in and when its frame is set later.

## Fix

In background mode `packages/desktop/src/main.ts` shows each window inactive but with opacity 0, without a shadow, and with mouse events ignored (`showUnseen`). The window is still shown, so Playwright drives the renderer as usual. Nothing can be seen, and clicks pass through to the app underneath. The "could not open" error box is logged instead of shown. `packages/app/e2e/desktop-background.spec.ts` checks that every window is visible to Electron but unfocused and fully transparent.

## Verification

To check for visible windows as well as focus, poll `CGWindowListCopyWindowInfo([.optionOnScreenOnly])` while the suite runs. It lists on-screen windows from front to back with their owner and `kCGWindowAlpha`. Record the frontmost app and the rank and alpha of every `Electron` window. Before the fix: Electron windows at rank 0 with alpha 1. After the fix: alpha 0 throughout, and the frontmost app never changed.
