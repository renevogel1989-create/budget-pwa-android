# Budget PWA Android

Separate PWA fuer das monatliche Kosten- und Ausgaben-Tracking.

## Ziel

- Bereitstellung ueber GitHub Pages
- Auf Android ueber Chrome installierbar
- Lokale, verschluesselte Speicherung in IndexedDB
- Keine Cloud-Datenbank, kein Speichern im Browser-Cache als Primaerdatenbank
- Import von CSV und optional XLSX

## Lokal testen

```powershell
cd "C:\Users\Markus\Documents\Codex\2026-05-08\hallo-ich-brauche-eine-app-eine\budget-pwa-android"
& "C:\Users\Markus\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 8088
```

Dann oeffnen:

```text
http://127.0.0.1:8088
```

## GitHub Pages

1. Neues Repository anlegen, z.B. `budget-pwa-android`.
2. Diese Dateien in das Repository laden.
3. In GitHub: `Settings` -> `Pages` -> `Deploy from a branch`.
4. Branch `main`, Ordner `/root` auswaehlen.
5. Danach die Pages-URL auf Android in Chrome oeffnen.
6. Chrome-Menue -> `Zum Startbildschirm hinzufuegen` oder `App installieren`.

## Import

Empfohlene Spalten:

- `Name`
- `Betrag` oder `Rate`
- `Faelligkeit` oder `Tag`
- `Kategorie`
- `Typ`
- `Restwert`
- `Beginn`
- `Ende`
- `Laufzeit`
- `Notizen`

CSV funktioniert offline. XLSX funktioniert, wenn die externe SheetJS-Bibliothek erreichbar ist.
