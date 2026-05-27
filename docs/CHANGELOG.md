# Changelog

## [0.1.1] - 2026-05-27

### Fixed
- **UI Architecture**: Fixed casing sensitivity issues breaking the Linux/Vercel build pipelines by normalizing all `components/ui` filenames to fully lowercase.
- **Radix UI Polymorphism**: Resolved `React.Children.only` crash during static prerendering in `Button` by wrapping internal children with `@radix-ui/react-slot`'s `<Slottable>` component when `asChild` is enabled.
- **TypeScript Strict Safety**: Corrected `DragEvent` generic typing conflicts in `DropZone` by refactoring custom handlers to explicitly handle `FileList`.
- **Badge Stability**: Updated `Badge` props to properly handle optional `children` and dynamic injection.
- **Production Build**: Verified that Next.js `npm run build` succeeds and successfully generates all 16 static routes without compiler or type-checker errors.
