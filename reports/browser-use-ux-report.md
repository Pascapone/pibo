# UX Report: Browser-Use Tool
**Datum:** 2026-05-03
**Tester:** Pibo (Coding Agent)
**Kontext:** Headless-Browsing auf Server-Umgebung, Nutzung über CLI-Wrapper

---

## Zusammenfassung

Das Browser-Use Tool ermöglicht grundsätzlich zuverlässiges automatisiertes Browsing über die Kommandozeile. Screenshot, Navigation und DOM-Inspektion funktionieren. Allerdings gibt es erhebliche Reibungspunkte beim Session-Management, der Fehlerbehandlung und der Lesbarkeit der Ausgaben. Für Agenten-Workflows ist das Tool nutzbar, aber nicht reibungslos.

---

## Was gut funktioniert hat

### 1. Screenshot-Feature
**Bewertung:** Sehr gut  
Screenshots werden zuverlässig erstellt und gespeichert. Das war die einzige visuelle Rückmeldung, die ich im Headless-Modus hatte, und sie hat jedes Mal funktioniert. Dateigröße und Viewport-Dimensionen werden ausgegeben – hilfreich für Debugging.

### 2. Navigation (`open`)
**Bewertung:** Gut  
Das Öffnen von URLs funktioniert, sobald die Browser-Session einmal steht. Die Ausgabe der aktuellen URL ist knapp und nützlich.

### 3. Persistentes Chrome-Profil
**Bewertung:** Gut (Konzept)  
Die Idee, ein persistentes Chrome-Profil über CDP zu nutzen, ist clever. Authentifizierungen bleiben erhalten, und man muss nicht jedes Mal neu einloggen.

### 4. Element-Indizes für Interaktion
**Bewertung:** Gut (Konzept)  
Die nummerierten Indizes (`[298]<a />`) machen es einfach, auf Elemente zu klicken, ohne komplexe Selektoren schreiben zu müssen. Das ist besonders für Agenten praktisch.

### 5. `doctor`-Kommando
**Bewertung:** Hilfreich  
Die Diagnose gibt einen schnellen Überblick über den Zustand der Installation. Netzwerk-Check und Browser-Check sind nützlich.

---

## Was schlecht funktioniert hat

### 1. SingletonLock / Hängende Prozesse (Kritisch)
**Problem:** Wenn ein alter Chrome-Prozess noch läuft (z.B. von einem vorherigen Tag), schlägt jeder neue Start fehl:
```
ERROR: Failed to create SingletonLock: File exists (17)
Chrome did not expose CDP on port XXXXX
```
**Impact:** Hoch. Der Agent muss manuell `ps aux | grep chrome` laufen lassen und Prozesse killen, bevor er weitermachen kann. Das ist nicht selbstheilend.

### 2. `--connect` existiert in der Hilfe, aber nicht als Command
**Problem:** `browser-use --help` listet `--connect` als Flag, aber `browser-use connect` wird als "invalid choice" abgelehnt. Sehr verwirrend.

### 3. CDP-Port-Discovery unzuverlässig
**Problem:** Der Wrapper startet Chrome manchmal auf einem Port, findet ihn aber nicht selbst wieder. Man muss manuell `ps aux` laufen lassen, um den Port zu finden und mit `--cdp-url` explizit anzugeben.

### 4. `state`-Ausgabe ist extrem schwer lesbar
**Problem:** Die DOM-Ausgabe ist als verschachtelter Baum mit massiver Einrückung formatiert. Für Menschen fast unleserlich. Man muss ständig `grep`, `head` und `sed` bemühen, um Links oder Text zu finden.
**Beispiel:**
```
[135]<tr id=47990318 />
	[136]<td />
		[137]<span />
			2.
	[139]<td />
		[141]<a id=up_47990318 />
```

### 5. Element-Indices sind volatil
**Problem:** Nach Navigation, Scroll oder DOM-Änderungen ändern sich die Indizes. Die Doku warnt zwar davor, aber man muss ständig `state` neu laufen lassen, bevor man klickt. Das führt zu einem mühsamen "Trial-and-Error"-Workflow.

### 6. Keine strukturierte Datenextraktion
**Problem:** Es gibt keinen einfachen Weg, z.B. alle Artikeltitel von Hacker News als saubere Liste zu extrahieren. Man bekommt entweder den vollen DOM-Baum oder gar nichts.

### 7. Headless-Modus gibt keine visuelle Rückmeldung
**Problem:** Im Headless-Modus (Standard auf Servern) sieht man nichts, bis man explizit einen Screenshot macht. Zwischen `scroll`, `click` und `open` gibt es keine Bestätigung, ob das Ergebnis sichtbar ist.

### 8. Eval-Output fehlt teilweise
**Problem:** `browser-use eval` wurde in diesem Test nicht genutzt, aber die Dokumentation erwähnt es als Datenextraktionsweg. Es ist unklar, wie gut sich JavaScript-Ergebnisse parsen lassen.

---

## UX-Verbesserungsvorschläge

### Priorität: Hoch

1. **Auto-Cleanup für hängende Chrome-Prozesse**
   - Beim Start prüfen, ob ein alter Prozess mit dem gleichen Profil läuft.
   - Automatisch terminieren oder eine Warnung mit "Auto-kill? (Y/n)" ausgeben.
   - Alternativ: `--force` Flag, das SingletonLock ignoriert.

2. **Strukturierte Ausgabe für `state`**
   - Ein Modus, der nur interaktive Elemente ausgibt: `browser-use state --interactive`
   - Ausgabe als Tabelle: Index | Tag | Text | URL | BBox
   - `--json` Flag für `state` (exisitiert für `get`, aber nicht für `state`)

3. **Zuverlässiges CDP-Port-Management**
   - Wenn Chrome schon läuft, soll der Wrapper den bestehenden Port automatisch detektieren statt einen neuen zu starten.
   - Eine `browser-use status` oder `browser-use ls` für laufende Chrome-Instanzen.

### Priorität: Mittel

4. **Stabilere Element-Referenzen**
   - Elemente über CSS-Selektor oder XPath adressierbar machen, nicht nur über volatile Indices.
   - Oder: Indices mit einem Hash des Element-Pfads stabilisieren.

5. **Besseres Scroll-Feedback**
   - Nach `scroll down` automatisch die neue Scroll-Position und sichtbare Elemente anzeigen.
   - Optional: `scroll down --screenshot`, das direkt ein Bild der neuen Position macht.

6. **Konsistentere CLI-Oberfläche**
   - `--connect` entweder als Command implementieren oder aus der Hilfe entfernen.
   - Alle Commands sollten `--json` unterstützen.

### Priorität: Niedrig

7. **Bessere Text-Extraktion**
   - `browser-use extract text --selector "h1"` oder `browser-use get text --all-links`
   - Das `extract` Command ist laut Doku vorhanden aber nicht implementiert – das sollte entweder fertiggestellt oder entfernt werden.

8. **Session-Wiederherstellung**
   - Wenn eine Session abrupt endet (Agent-Crash, Timeout), sollte `browser-use sessions` die noch laufende Chrome-Instanz erkennen und als aktive Session listen.

---

## Auf was man sich mehr konzentrieren sollte

**Schnelles, stabiles Session-Management.** Das ist der größte Pain Point. Ein Agent will nicht 3 Commands investieren, nur um herauszufinden, ob Chrome läuft. Das Tool sollte "fire and forget" sein: `browser-use open URL` sollte immer funktionieren, egal ob Chrome schon läuft oder nicht.

**Lesbare Ausgaben.** Aktuell ist das Tool sehr "Maschinen-freundlich" (DOM-Baum), aber für Agenten, die Entscheidungen treffen müssen, wäre eine strukturierte Zusammenfassung wesentlich besser. Ein Agent will nicht 500 Zeilen verschachtelten HTML-Baums parsen, um einen Link zu finden.

**Visuelles Debugging ohne Headed-Mode.** Da der Headless-Mode der Standard auf Servern ist, sollten Screenshots näher am Core-Workflow sein. Z.B. eine Option, nach jedem Befehl automatisch einen Screenshot zu machen.

---

## Fazit

Browser-Use ist ein mächtiges Tool mit soliden Grundlagen, leidet aber unter "rough edges" im Bereich Session-Management und Ausgabeformat. Für gelegentliches Browsing reicht es, für intensive Agent-Workflows (wie das Surfen von 5+ Seiten in Folge) wird die Reibung spürbar. Die höchste Rendite würde eine Investition in **stabiles Session-Startup** und **strukturierte State-Ausgaben** bringen.

**Gesamtnote:** 6/10 – Funktional, aber mit erheblichem UX-Potenzial.
