# UI Components: Canvas

## Overview

This directory contains the library of generic, reusable React components that serve as the fundamental building blocks for the "UI Specialist" agent. When the agent generates a UI, it does not write HTML from scratch; instead, it composes a UI by selecting and configuring these pre-built components.

## Component Library

- **`DataTable.tsx`:** A flexible component that takes an array of data objects and renders them in a styled, responsive table. It dynamically generates columns from the data's keys.

- **`Form.tsx`:** A component that dynamically generates a complete form with input fields, labels, and a submit button based on a provided schema. This is used for creating new data records.

- **`DetailView.tsx`:** A component designed to display the key-value pairs of a single data object in a clean, readable format. This is used for viewing the details of a single record.

## Design Philosophy

This component-based approach is crucial for ensuring the quality and consistency of the generated UIs. By constraining the AI to use a curated set of well-designed components, we guarantee that all generated applications will have a professional look and feel and will be maintainable.
