# Orekit Engine - Schritt 1: Funktionalitaeten

## Ziel

`orekit_engine.py` soll die fachliche Kernlogik fuer die Orbit-Propagation und Overpass-Extraktion enthalten.
Die Engine bleibt unabhaengig von FastAPI, State-Management und SatOS-Zugriffen. Sie bekommt bereits aufbereitete Domain-Modelle als Input und gibt einen JSON-freundlichen Payload fuer das Frontend zurueck.

Die grobe Struktur aus `run_orekit_engine` bleibt erhalten:

1. Inputs entgegennehmen und vorbereiten.
2. Fuer jeden Satelliten einen Orekit-Propagator aufbauen.
3. Fuer jede Groundstation einen Sichtbarkeitsdetektor anhaengen.
4. Das Zeitintervall propagieren.
5. Globale Tracks und Overpass-Daten extrahieren.
6. Einen konsistenten Ergebnis-Payload zurueckgeben.

## Codestil fuer diese Datei

- Variablennamen beschreiben fachliche Bedeutung, nicht technische Abkuerzungen.
- Die Struktur folgt dem Ablauf der Berechnung von oben nach unten.
- Helper-Funktionen werden nur eingefuehrt, wenn sie im Code mindestens dreimal verwendet werden.
- Einmalige fachliche Schritte werden direkt im passenden Block implementiert oder als klar benannte Top-Level-Funktion gefuehrt, wenn sie eine eigenstaendige Funktionalitaet darstellen.
- Core-Code kennt keine FastAPI-Details. Fortschritt wird nur ueber den optionalen Callback gemeldet.

## Eingangsdaten

`run_orekit_engine` verwendet diese Inputs:

- `task_id`: ID fuer Fortschrittsmeldungen.
- `satellite_infos`: Liste von `SatelliteInformation`.
- `groundstation_infos`: Liste von `GroundStationInformation`.
- `time_interval`: `TimeInterval` mit Start- und Endzeit.
- `on_progress_update`: optionaler Callback mit `(task_id, message, progress)`.

Erwartete fachliche Bedeutung:

- Satellitenposition `position_r` ist ein kartesischer Positionsvektor in Meter.
- Satellitengeschwindigkeit `velocity_v` ist ein kartesischer Geschwindigkeitsvektor in Meter pro Sekunde.
- `state_timestamp` ist die Epoche des Zustandsvektors.
- Satellitenzustand ist im GCRF Frame.
- Groundstation-Koordinaten `latitude` und `longitude` werden als Grad interpretiert.
- Groundstation-Hoehe wird vorerst als `0.0 m` angenommen, weil das aktuelle Domain-Modell kein Hoehenfeld enthaelt.
- Mindest-Elevation kommt aus `GroundStationInformation.min_elevation_angle_deg` und wird als Grad interpretiert.

## Funktionalitaetsgruppe 1: Input-Validierung

Die Engine soll frueh und klar abbrechen, wenn die Eingaben nicht berechenbar sind.

Zu pruefen:

- Es gibt mindestens einen Satelliten.
- Es gibt mindestens eine Groundstation.
- `time_interval.end_time` liegt nach `time_interval.start_time`.
- Jeder Satellit hat genau drei Positionswerte.
- Jeder Satellit hat genau drei Geschwindigkeitswerte.
- Jeder Satellit hat einen Namen.
- Jede Groundstation hat einen Namen.
- Jede Groundstation hat eine Latitude im Bereich `[-90.0, 90.0]`.
- Jede Groundstation hat eine Longitude im Bereich `[-180.0, 180.0]`.
- Jede Groundstation hat eine Mindest-Elevation im Bereich `[0.0, 90.0]`.

Fehler werden als `ValueError` geworfen. `app.services.task_orchestrator` faengt diese Fehler bereits zentral ab und setzt den Task auf `failed`.

## Funktionalitaetsgruppe 2: Orekit-Umgebung vorbereiten

Die Engine muss Orekit genau so vorbereiten, dass alle spaeteren Orekit-Aufrufe funktionieren.

Zu klaeren und umzusetzen:

- Orekit-Daten aus `orekit-data.zip` oder `orekit-data/` laden.
- JVM/Orekit-Initialisierung idempotent halten, damit mehrere API-Tasks im gleichen Python-Prozess nicht mehrfach fehlerhaft initialisieren.
- `JAVA_HOME` und `PATH` ueber `jdk4py` setzen, wie in der alten Pipeline bereits vorgemacht.
- Orekit-Zeitkonvertierung zwischen Python `datetime` und `AbsoluteDate` bereitstellen.

Diese Funktionalitaet ist technisch notwendig, aber sie bleibt innerhalb der Engine gekapselt.

## Funktionalitaetsgruppe 3: Propagator pro Satellit aufbauen

Die Skeleton-Idee `create_state_from_tle` wird durch den tatsaechlichen Domain-Input ersetzt:
Der kanonische Input ist ein kartesischer GCRF-Zustandsvektor, kein TLE.

Pro Satellit braucht die Engine:

- Orekit `Vector3D` fuer Position und Geschwindigkeit.
- Orekit `PVCoordinates`.
- Orekit `CartesianOrbit` im GCRF Frame zur Epoche `state_timestamp`.
- Orekit `SpacecraftState`.
- `NumericalPropagator` mit kartesischem Orbit-Typ.
- Gravitation mindestens mit Newtonian Attraction.
- J2-Stoerung als sinnvoller MVP fuer VLEO-Propagation.
- Integrator-Toleranzen aus einer klaren Positions-Toleranz, zum Beispiel `10.0 m`.

Die Engine propagiert anschliessend das angefragte Intervall von `time_interval.start_time` bis `time_interval.end_time`.
Der initiale State darf zeitlich vor dem Start des Planungsintervalls liegen.

## Funktionalitaetsgruppe 4: Groundstation-Geometrie erzeugen

Fuer jede Groundstation wird eine Orekit-Sichtbarkeitsgeometrie erzeugt.

Pro Groundstation braucht die Engine:

- Earth-fixed Frame: ITRF mit IERS 2010.
- Erdmodell: `OneAxisEllipsoid`.
- `GeodeticPoint` aus Latitude, Longitude und Hoehe.
- `TopocentricFrame` fuer lokale Elevation, Azimuth und Range.

Die Groundstation-Frames werden in der Satelliten-Schleife verwendet, weil die Eventdetektoren am jeweiligen Propagator haengen.

## Funktionalitaetsgruppe 5: Overpass-Events detektieren

Die Engine soll fuer jedes Satellit-Groundstation-Paar Sichtbarkeitsintervalle extrahieren.

Pro Paar wird ein `ElevationDetector` verwendet:

- Mindest-Elevation: `groundstation_info.min_elevation_angle_deg`.
- AOS ist der Zeitpunkt, an dem die Elevation die Schwelle aufsteigend kreuzt.
- LOS ist der Zeitpunkt, an dem die Elevation die Schwelle absteigend kreuzt.
- Jeder komplette Pass wird als Event mit Satellit, Groundstation, Startzeit und Endzeit gespeichert.

Randfaelle:

- Wenn ein Satellit bereits am Intervallstart sichtbar ist, soll der Overpass bei `time_interval.start_time` beginnen.
- Wenn ein Satellit am Intervallende noch sichtbar ist, soll der Overpass bei `time_interval.end_time` enden.
- Unvollstaendige Event-Paare duerfen nicht stillschweigend zu falschen Blocks werden.

## Funktionalitaetsgruppe 6: Orbit global track extrahieren

Fuer jeden Satelliten soll ein niedrig aufgeloester Track erzeugt werden.
Der Track enthaelt den propagierten kartesischen GCRF-State als eigentlichen Propagation-Output und zusaetzlich geodetic Latitude, Longitude und Altitude als abgeleitete Frontend-Anzeigekoordinaten.

Empfohlene Sampling-Rate fuer den MVP:

- `60 s` fuer `global_tracks`.

Jeder Trackpunkt soll JSON-freundlich sein:

```json
{
  "timestamp": "2026-07-08T10:00:00+00:00",
  "position_gcrf_m": [1000.0, 2000.0, 3000.0],
  "velocity_gcrf_mps": [1.0, 2.0, 3.0],
  "latitude_deg": 48.1,
  "longitude_deg": 11.6,
  "altitude_m": 300000.0
}
```

Top-Level-Struktur:

```json
"global_tracks": {
  "SATELLITE_NAME": [
    {
      "timestamp": "...",
      "position_gcrf_m": [0.0, 0.0, 0.0],
      "velocity_gcrf_mps": [0.0, 0.0, 0.0],
      "latitude_deg": 0.0,
      "longitude_deg": 0.0,
      "altitude_m": 0.0
    }
  ]
}
```

## Funktionalitaetsgruppe 7: Overpass high-res profile extrahieren

Fuer jeden detektierten Overpass soll ein hochaufgeloestes Profil erzeugt werden.

Empfohlene Sampling-Rate fuer den MVP:

- `10 s` fuer Overpass-Profile.

Jeder Profilpunkt soll enthalten:

- `timestamp`
- Satellitenposition als `latitude_deg`, `longitude_deg`, `altitude_m`
- lokale Groundstation-Geometrie als `elevation_deg`, `azimuth_deg`, `range_m`

Aus dem Profil wird zusaetzlich eine Overpass-Zusammenfassung berechnet:

- `duration_seconds`
- `max_elevation_deg`

## Funktionalitaetsgruppe 8: Frontend-tauglichen Payload erzeugen

Die Engine darf intern eine Dataclass fuer das Ergebnis verwenden, damit die Rueckgabestruktur im Core klar benannt und typisiert ist.
Diese Dataclass soll aber nur JSON-freundliche Felder enthalten:

```python
@dataclass
class PropagationRawResult:
    metadata: dict
    global_tracks: dict[str, list[dict]]
    overpass_blocks: list[dict]
```

`run_orekit_engine` gibt ein `PropagationRawResult` zurueck.
Damit bleibt die Core-Struktur lesbar und typisiert.
Die Umwandlung in ein normales Dictionary fuer JSON/API-Zwecke passiert spaeter im App-/Task-Layer.

Die spaeter serialisierte Payload-Struktur behaelt die beiden fachlichen Hauptbereiche aus dem Skeleton:

```json
{
  "metadata": {
    "task_id": "prop_run_001",
    "start_time": "2026-07-08T10:00:00+00:00",
    "end_time": "2026-07-08T12:00:00+00:00",
    "global_track_step_seconds": 60,
    "overpass_step_seconds": 10
  },
  "global_tracks": {},
  "overpass_blocks": []
}
```

`overpass_blocks` ist eine flache Liste, sortiert nach `start_time`.
Ein Block soll so aussehen:

```json
{
  "overpass_id": "overpass_000001",
  "satellite_name": "SATELLITE_NAME",
  "groundstation_name": "GROUNDSTATION_NAME",
  "start_time": "2026-07-08T10:15:00+00:00",
  "end_time": "2026-07-08T10:22:00+00:00",
  "duration_seconds": 420.0,
  "max_elevation_deg": 37.5,
  "high_res_trajectory": []
}
```

`overpass_id` ist nur ein technischer Key fuer das Frontend und fuer spaetere Referenzen innerhalb des Ergebnis-Payloads.
Er ist keine SatOS-ID und keine fachliche Missions-ID.
Die fachliche Identitaet des Overpasses ergibt sich aus Satellit, Groundstation, Startzeit und Endzeit.
Groundstations werden im Ergebnis-Payload ueber `groundstation_name` referenziert, weil es keine separate `groundstation_id` gibt.

Im finalen Ergebnis-Payload werden Zeiten als ISO-Strings ausgegeben.
Innerhalb der Berechnung duerfen und sollen `datetime`-Objekte und Orekit-/Java-Objekte verwendet werden.
Sie werden nur nicht ueber die API-Grenze an das Frontend zurueckgegeben, weil der Payload JSON-freundlich, stabil und unabhaengig von Python-/Orekit-Objektmodellen bleiben soll.
Dataclasses werden vor der Rueckgabe ebenfalls in einfache Dictionaries, Listen, Strings und Zahlen umgewandelt.

## Funktionalitaetsgruppe 9: Fortschritt melden

Wenn `on_progress_update` gesetzt ist, meldet die Engine nachvollziehbare Statuspunkte.

Vorgeschlagene Meldungen:

- `Preparing Orekit engine...`
- `Validating inputs...`
- `Propagating <satellite_name>...`
- `Extracting overpasses for <satellite_name>...`
- `Complete`

Progress-Werte bleiben zwischen `0` und `100`.
Die Satelliten-Schleife verteilt den Hauptanteil des Fortschritts gleichmaessig auf alle Satelliten.

## Nicht-Ziele fuer den MVP

Diese Punkte werden bewusst nicht in der ersten Implementierung geloest:

- Kein Scheduling oder Trade-off Scoring.
- Kein Konfliktloesen zwischen simultanen Links.
- Kein Schreiben von Activities zurueck nach SatOS.
- Kein TLE-/SGP4-Modus.
- Keine Atmosphaerenbremsung.
- Keine Groundstation-Hoehe, solange das Domain-Modell sie nicht bereitstellt.

## Offene Entscheidungen vor Schritt 2

1. Soll `GroundStationInformation` wieder `elevation_m` und `min_elevation_angle_deg` enthalten, oder bleiben fuer den MVP `0.0 m` und `0.0 deg` als Defaults?
Antwort: Es soll nur `min_elevation_angle_deg` eingeführt werden (ist auch schon in domain.py deklariert)
2. Soll `SatelliteInformation` eine stabile `id` bekommen, oder ist `name` der stabile Key fuer `global_tracks` und `overpass_blocks`?
Antwort: `name` ist der stabile key
3. Sollen naive `datetime`-Werte abgelehnt oder als UTC interpretiert werden?
Antwort: Sollen als UTC interpretiert werden
4. Reichen `60 s` fuer globale Tracks und `10 s` fuer Overpass-Profile als Startwerte?
Antwort: Ja
5. Soll `metadata` im Ergebnis-Payload enthalten sein, oder sollen die Top-Level-Keys strikt bei `global_tracks` und `overpass_blocks` bleiben?
Antwort: `metadata` soll enthalten sein
6. Soll `overpass_id` nur innerhalb eines Engine-Runs stabil sein (`overpass_000001`) oder deterministisch aus Satellit, Groundstation und Zeiten erzeugt werden?
Antwort: Deterministisch aus Satellit und Groundstation-Name
