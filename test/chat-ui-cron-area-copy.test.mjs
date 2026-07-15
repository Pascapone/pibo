import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readCronAreaSource() {
	return readFile(new URL("../src/apps/chat-ui/src/CronArea.tsx", import.meta.url), "utf8");
}

test("Cron Schedule Builder uses consistent English preset and weekday labels", async () => {
	const source = await readCronAreaSource();

	for (const text of [
		"Once after a delay",
		"e.g. in 20 minutes",
		"Once at a date and time",
		"Choose a date and time",
		"Daily",
		"Run at a set time each day",
		"Weekly",
		"Choose weekdays",
		"Monthly",
		"Choose a day of the month",
		"Interval",
		"Repeat every n time units",
		"Cron expression",
		"Enter a 5-field cron expression",
	]) {
		assert.ok(source.includes(text), `missing English schedule copy: ${text}`);
	}

	for (const [short, label] of [
		["Mon", "Monday"],
		["Tue", "Tuesday"],
		["Wed", "Wednesday"],
		["Thu", "Thursday"],
		["Fri", "Friday"],
		["Sat", "Saturday"],
		["Sun", "Sunday"],
	]) {
		assert.ok(source.includes(`short: "${short}", label: "${label}"`));
	}

	for (const text of [
		"Einmal später",
		"z.B. in 20 Minuten",
		"Einmal am Datum",
		"Datepicker + Uhrzeit",
		"Täglich",
		"Cron aus Uhrzeit",
		"Wöchentlich",
		"Wochentage wählen",
		"Monatlich",
		"Tag im Monat",
		"Intervall",
		"Cron-Rhythmus",
		"Cron direkt",
		"5 Felder manuell",
		"Montag",
		"Dienstag",
		"Mittwoch",
		"Donnerstag",
		"Freitag",
		"Samstag",
		"Sonntag",
	]) {
		assert.equal(source.includes(text), false, `found untranslated Cron copy: ${text}`);
	}
});
