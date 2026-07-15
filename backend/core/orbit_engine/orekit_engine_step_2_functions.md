# Orekit Engine - Schritt 2: Python-Funktionen

## Ziel

Dieses Dokument uebersetzt die Funktionalitaeten aus Schritt 1 in konkrete Python-Funktionen.
Die Funktionen werden hier als Schnittstellen, Verantwortlichkeiten und Rueckgabewerte festgelegt.
Die eigentliche Implementierung erfolgt danach in Schritt 3 Funktion fuer Funktion.

## Uebernommene Entscheidungen aus Schritt 1

- `SatelliteInformation.name` ist der stabile Satelliten-Key.
- `GroundStationInformation.min_elevation_angle_deg` wird verwendet.
- `GroundStationInformation.min_elevation_angle_deg` muss im Bereich `[0.0, 90.0]` liegen.
- Groundstation-Hoehe bleibt im MVP `0.0 m`, weil das Domain-Modell kein Hoehenfeld enthaelt.
- Naive `datetime`-Werte werden als UTC interpretiert.
- Globale Tracks werden mit `60 s` gesampelt.
- Overpass-Profile werden mit `10 s` gesampelt.
- `metadata` bleibt im Ergebnis-Payload enthalten.
- `run_orekit_engine` gibt ein `PropagationRawResult` zurueck.
- Die Umwandlung in ein JSON-freundliches `dict` passiert spaeter im App-/Task-Layer.

## Wichtige ID-Klaerung

Ein reiner Identifier aus Satellit und Groundstation ist nicht eindeutig, wenn dasselbe Paar im Zeitintervall mehrere Overpasses hat.
Deshalb soll der Ergebnisblock zwei Konzepte sauber trennen:

- `satellite_name` und `groundstation_name` beschreiben das fachliche Paar.
- `overpass_id` identifiziert einen konkreten Overpass-Block innerhalb dieses Paares.

Empfohlene deterministische Form fuer den MVP:

```python
overpass_id = f"{satellite_name}__{groundstation_name}__pass_{pair_pass_number:03d}"
```

`pair_pass_number` wird pro Satellit-Groundstation-Paar nach Startzeit sortiert hochgezaehlt.
Damit bleibt die ID lesbar, deterministisch fuer gleiche Inputs und ohne Zeitstempel-Monster im Key.
Es gibt keine separate `groundstation_id`; Groundstations werden im Ergebnis-Payload ueber `groundstation_name` referenziert.

## Geplanter Modulaufbau

`orekit_engine.py` soll grob in dieser Reihenfolge aufgebaut werden:

1. Imports
2. Konstanten
3. Kleine interne Dataclasses
4. `run_orekit_engine`
5. Fachliche Einzelfunktionen
6. Erlaubte Helper-Funktionen, die mindestens dreimal genutzt werden

Orekit-/Java-Klassen sollen erst nach erfolgreicher Orekit-Initialisierung importiert werden.
Das verhindert Importprobleme, bevor die JVM gestartet ist.

## Konstanten

Diese Konstanten gehoeren in `orekit_engine.py`, weil sie die Engine-Konfiguration beschreiben:

```python
GLOBAL_TRACK_STEP_SECONDS = 60.0
OVERPASS_PROFILE_STEP_SECONDS = 10.0
DEFAULT_GROUNDSTATION_ALTITUDE_M = 0.0
DEFAULT_POSITION_TOLERANCE_M = 10.0
```

Erdkonstanten werden nicht als zusaetzliche Aliase in `orekit_engine.py` definiert.
An den Stellen, an denen Orekit sie braucht, werden sie direkt aus der bestehenden `constants.py` gelesen, zum Beispiel `Constants.R_E`, `Constants.MU_E`, `Constants.f_E` und `Constants.J2_E`.
Damit gibt es eine einzige Quelle fuer die numerischen Werte und keine zweite Namensebene in der Engine.

## Dataclasses

### PropagationRawResult

Ort: `core.models.domain`

```python
@dataclass
class PropagationRawResult:
    metadata: dict[str, object]
    global_tracks: dict[str, list[dict[str, object]]]
    overpass_blocks: list[dict[str, object]]
```

Diese Dataclass enthaelt nur JSON-freundliche Werte.
`run_orekit_engine` gibt sie direkt zurueck.
Der App-/Task-Layer kann sie spaeter fuer den API-Payload in ein normales Dictionary umwandeln.

### GroundStationRuntimeContext

Ort: `core.orbit_engine.orekit_engine`

```python
@dataclass
class GroundStationRuntimeContext:
    groundstation_info: GroundStationInformation
    topocentric_frame: Any
```

Diese Dataclass ist nur fuer die laufende Berechnung gedacht.
Sie wird nicht an das Frontend zurueckgegeben.
Sie verhindert, dass `GroundStationInformation` und der dazugehoerige Orekit-`TopocentricFrame` als zwei getrennte Listen oder lose Tupel durch die Engine gereicht werden.
Damit bleibt beim Anhaengen der Detektoren und beim Extrahieren der Overpass-Profile eindeutig, welcher Frame zu welcher Groundstation gehoert.

### OverpassEvent

Ort: `core.orbit_engine.orekit_engine`

```python
@dataclass
class OverpassEvent:
    satellite_name: str
    groundstation_info: GroundStationInformation
    start_time: datetime
    end_time: datetime
```

Diese Dataclass sammelt AOS/LOS-Events intern mit echten `datetime`-Objekten.
Erst beim Bau des `overpass_blocks` Payloads werden Zeiten zu ISO-Strings.

## Hauptfunktion

### run_orekit_engine

```python
def run_orekit_engine(
    task_id: str,
    satellite_infos: list[SatelliteInformation],
    groundstation_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
    on_progress_update: Callable[[str, str, int], None] | None = None,
) -> PropagationRawResult:
```

Verantwortung:

- Orchestriert den kompletten Engine-Lauf.
- Validiert Inputs.
- Initialisiert Orekit.
- Erstellt einmalig Groundstation-Kontexte.
- Propagiert jeden Satelliten einzeln.
- Sammelt globale Tracks.
- Sammelt Overpass-Events.
- Baut `overpass_blocks`.
- Gibt `PropagationRawResult` zurueck.

Grobe Struktur:

```python
def run_orekit_engine(...):
    report_progress(task_id, "Preparing Orekit engine...", 0, on_progress_update)
    validate_orekit_engine_inputs(...)

    start_time = normalize_datetime_to_utc(time_interval.start_time)
    end_time = normalize_datetime_to_utc(time_interval.end_time)

    setup_orekit_environment()

    # Earth frame and Earth shape are created here and passed down.
    # They do not need a one-use helper function.

    groundstation_contexts = build_groundstation_contexts(...)
    global_tracks = {}
    overpass_blocks = []

    for satellite_index, satellite_info in enumerate(satellite_infos):
        propagator, inertial_frame = build_satellite_propagator(...)
        satellite_event_log = []

        attach_visibility_detectors(...)
        ephemeris = propagate_satellite(...)
        global_tracks[satellite_info.name] = extract_global_track(...)

        # Events are sorted before overpass blocks are created.
        # pair_pass_number is tracked per satellite/station pair.
        for overpass_event in sorted_events:
            high_res_trajectory = extract_overpass_profile(...)
            overpass_blocks.append(build_overpass_block(...))

    overpass_blocks.sort(key=lambda block: block["start_time"])

    metadata = build_result_metadata(...)
    propagation_raw_result = PropagationRawResult(...)
    return propagation_raw_result
```

## Fachliche Einzelfunktionen

Diese Funktionen stehen fuer echte fachliche Teilschritte.
Sie sind keine kleinen Convenience-Helper.

### validate_orekit_engine_inputs

```python
def validate_orekit_engine_inputs(
    satellite_infos: list[SatelliteInformation],
    groundstation_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
) -> None:
```

Verantwortung:

- Bricht frueh mit `ValueError` ab, wenn die Engine nicht sinnvoll rechnen kann.
- Prueft Satellitenliste, Groundstationliste und Zeitintervall.
- Prueft Positions- und Geschwindigkeitsvektoren auf genau drei Werte.
- Prueft Latitude, Longitude und Mindest-Elevation.
- Mindest-Elevation ist eine Sichtbarkeitsschwelle und muss im Bereich `[0.0, 90.0]` liegen.

Wichtig:

- Diese Funktion normalisiert keine Werte.
- Sie validiert nur.

### setup_orekit_environment

```python
def setup_orekit_environment() -> None:
```

Verantwortung:

- Verwendet das extrahierte `orekit-data/` Verzeichnis im Projektroot.
- Setzt `JAVA_HOME` und erweitert `PATH` ueber `jdk4py`.
- Initialisiert die JVM und Orekit-Daten idempotent.
- Speichert intern nur, dass die Orekit-Umgebung in diesem Python-Prozess bereits initialisiert wurde.

Wichtig:

- Die Auswahl des Datenpfads und des JVM-Pfads bleibt in dieser Funktion.
- Dafuer werden keine einmalig genutzten Mini-Helper angelegt.

### build_groundstation_contexts

```python
def build_groundstation_contexts(
    groundstation_infos: list[GroundStationInformation],
    earth_shape: Any,
) -> list[GroundStationRuntimeContext]:
```

Verantwortung:

- Erstellt fuer jede Groundstation einen `GeodeticPoint`.
- Erstellt fuer jede Groundstation einen `TopocentricFrame`.
- Kapselt Groundstation-Domainmodell und Frame in `GroundStationRuntimeContext`.

Input-Annahmen:

- Latitude und Longitude liegen in Grad vor.
- Hoehe ist im MVP `DEFAULT_GROUNDSTATION_ALTITUDE_M`.

### build_satellite_propagator

```python
def build_satellite_propagator(
    satellite_info: SatelliteInformation,
    position_tolerance_m: float = DEFAULT_POSITION_TOLERANCE_M,
) -> tuple[Any, Any]:
```

Rueckgabe:

- `propagator`
- `inertial_frame`

Verantwortung:

- Wandelt den kartesischen GCRF-State des Satelliten in Orekit-Objekte um.
- Baut `PVCoordinates`.
- Baut `CartesianOrbit`.
- Baut `SpacecraftState`.
- Baut `NumericalPropagator`.
- Fuegt Newtonian Attraction hinzu.
- Fuegt J2-Stoerung hinzu.

Wichtig:

- Der State kommt aus `position_r`, `velocity_v` und `state_timestamp`.
- Es wird kein TLE verwendet.

### attach_ElevationDetectors

```python
def attach_ElevationDetectors(
    propagator: Any,
    satellite_info: SatelliteInformation,
    groundstation_contexts: list[GroundStationRuntimeContext],
    satellite_event_log: list[OverpassEvent],
    propagation_start_time: datetime,
    propagation_end_time: datetime,
) -> None:
```

Verantwortung:

- Haengt pro Groundstation einen `ElevationDetector` an den Satelliten-Propagator.
- Verwendet `groundstation_info.min_elevation_angle_deg` als Elevationsschwelle.
- Schreibt gefundene AOS/LOS-Paare in `satellite_event_log`.

Wichtig:

- Der konkrete Orekit/JPype Event-Handler wird in Schritt 3 an dieser Stelle implementiert.
- Sichtbarkeit am Intervallstart und Intervallende wird hier oder direkt im Event-Handler sauber behandelt.

### OverpassEventHandler

```python
class OverpassEventHandler:
    def __init__(
        self,
        satellite_name: str,
        groundstation_info: GroundStationInformation,
        satellite_event_log: list[OverpassEvent],
        propagation_start_time: datetime,
        propagation_end_time: datetime,
    ) -> None:
        ...
```

Verantwortung:

- Merkt sich zu einem Detector, welcher Satellit und welche Groundstation gemeint sind.
- Erstellt bei AOS/LOS ein `OverpassEvent`.
- Schreibt das Event in `satellite_event_log`.

Wichtig:

- Die genaue Methodensignatur fuer Orekit-Callbacks wird in Schritt 3 beim Implementieren und Testen gegen `orekit_jpype` fixiert.
- Diese Klasse ist notwendig, weil der Propagator mehrere Groundstation-Detektoren gleichzeitig bekommt.

### propagate_satellite

```python
def propagate_satellite(
    propagator: Any,
    start_time: datetime,
    end_time: datetime,
) -> Any:
```

Verantwortung:

- Aktiviert den Orekit Ephemeris Generator.
- Propagiert von `start_time` bis `end_time`.
- Gibt die generierte Ephemeris zurueck.

### extract_global_track

```python
def extract_global_track(
    ephemeris: Any,
    inertial_frame: Any,
    earth_shape: Any,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = GLOBAL_TRACK_STEP_SECONDS,
) -> list[dict[str, object]]:
```

Verantwortung:

- Sampelt die Ephemeris alle `step_seconds`.
- Speichert den propagierten kartesischen GCRF-State.
- Wandelt Satellitenpositionen zusaetzlich in geodetic Latitude, Longitude und Altitude um.
- Gibt eine JSON-freundliche Liste fuer `global_tracks[satellite_name]` zurueck.

Rueckgabeformat pro Punkt:

```python
{
    "timestamp": "...",
    "position_gcrf_m": [0.0, 0.0, 0.0],
    "velocity_gcrf_mps": [0.0, 0.0, 0.0],
    "latitude_deg": 0.0,
    "longitude_deg": 0.0,
    "altitude_m": 0.0,
}
```

### extract_overpass_profile

```python
def extract_overpass_profile(
    ephemeris: Any,
    inertial_frame: Any,
    earth_shape: Any,
    groundstation_context: GroundStationRuntimeContext,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = OVERPASS_PROFILE_STEP_SECONDS,
) -> list[dict[str, object]]:
```

Verantwortung:

- Sampelt die Ephemeris innerhalb eines Overpasses alle `step_seconds`.
- Berechnet geodetic Latitude, Longitude und Altitude.
- Berechnet Elevation, Azimuth und Range relativ zur Groundstation.

Rueckgabeformat pro Punkt:

```python
{
    "timestamp": "...",
    "latitude_deg": 0.0,
    "longitude_deg": 0.0,
    "altitude_m": 0.0,
    "elevation_deg": 0.0,
    "azimuth_deg": 0.0,
    "range_m": 0.0,
}
```

### build_overpass_block

```python
def build_overpass_block(
    overpass_event: OverpassEvent,
    high_res_trajectory: list[dict[str, object]],
    pair_pass_number: int,
) -> dict[str, object]:
```

Verantwortung:

- Baut den JSON-freundlichen Overpass-Block fuer genau einen Overpass.
- Berechnet `duration_seconds`.
- Berechnet `max_elevation_deg` aus `high_res_trajectory`.
- Erstellt `overpass_id` deterministisch aus Satellit, Groundstation-Name und `pair_pass_number`.

Rueckgabeformat:

```python
{
    "overpass_id": "...",
    "satellite_name": "...",
    "groundstation_name": "...",
    "start_time": "...",
    "end_time": "...",
    "duration_seconds": 0.0,
    "max_elevation_deg": 0.0,
    "high_res_trajectory": [],
}
```

### build_result_metadata

```python
def build_result_metadata(
    task_id: str,
    start_time: datetime,
    end_time: datetime,
    global_track_step_seconds: float,
    overpass_profile_step_seconds: float,
) -> dict[str, object]:
```

Verantwortung:

- Baut den `metadata`-Block fuer `PropagationRawResult`.
- Haelt Lauf- und Sampling-Informationen an einer klar benannten Stelle.
- Gibt nur JSON-freundliche Werte zurueck.

Rueckgabeformat:

```python
{
    "task_id": "...",
    "start_time": "...",
    "end_time": "...",
    "global_track_step_seconds": 60.0,
    "overpass_profile_step_seconds": 10.0,
}
```

## Erlaubte Helper-Funktionen

Diese Helper sind erlaubt, weil sie im geplanten Code mindestens dreimal verwendet werden.

### normalize_datetime_to_utc

```python
def normalize_datetime_to_utc(value: datetime) -> datetime:
```

Verantwortung:

- Interpretiert naive `datetime`-Werte als UTC.
- Wandelt timezone-aware `datetime`-Werte nach UTC.

Verwendung:

- `time_interval.start_time`
- `time_interval.end_time`
- `satellite_info.state_timestamp`
- Eventzeiten
- Sampling-Zeiten

### to_utc_iso_string

```python
def to_utc_iso_string(value: datetime) -> str:
```

Verantwortung:

- Normalisiert nach UTC.
- Gibt einen stabilen ISO-String fuer den JSON-Payload zurueck.

Verwendung:

- `metadata.start_time`
- `metadata.end_time`
- Trackpunkt-Zeitstempel
- Overpass-Startzeit
- Overpass-Endzeit
- High-Res-Profil-Zeitstempel

### report_progress

```python
def report_progress(
    task_id: str,
    message: str,
    progress: int,
    on_progress_update: Callable[[str, str, int], None] | None,
) -> None:
```

Verantwortung:

- Kapselt die optionale Callback-Pruefung.
- Begrenzung des Progress-Werts auf `0..100`.
- Ruft `on_progress_update(task_id, message, progress)` nur auf, wenn ein Callback existiert.

Verwendung:

- Vorbereitung
- Validierung
- Pro Satellit
- Overpass-Extraktion
- Abschluss

## Bewusst nicht ausgelagerte Einmal-Logik

Diese Schritte werden vorerst nicht als eigene Funktionen angelegt, weil sie nur einmal gebraucht werden:

- Earth Frame und Earth Shape in `run_orekit_engine` erzeugen.
- Orekit-Datenpfad innerhalb von `setup_orekit_environment` suchen.
- JVM-Pfad innerhalb von `setup_orekit_environment` suchen.
- Zeit-Sampling als separate Funktion. Die Schleife zum Erzeugen einzelner Sample-Zeitpunkte bleibt direkt in `extract_global_track` und `extract_overpass_profile`.

## Offene Fragen fuer Schritt 3

1. Wird `GroundStationRuntimeContext` wirklich gebraucht?
   Entscheidung: Ja, wir behalten diese Dataclass.
   Der Groundstation-Kontext wird spaeter sowohl beim Anhaengen der Visibility-Detektoren als auch beim Extrahieren der Overpass-Profile benoetigt.

## Vorgeschlagene Implementierungsreihenfolge fuer Schritt 3

1. `PropagationRawResult` in `core.models.domain` finalisieren.
2. Imports und Konstanten in `orekit_engine.py` bereinigen.
3. `normalize_datetime_to_utc`, `to_utc_iso_string`, `report_progress` implementieren.
4. `validate_orekit_engine_inputs` implementieren.
5. `setup_orekit_environment` implementieren.
6. `GroundStationRuntimeContext` und `build_groundstation_contexts` implementieren.
7. `build_satellite_propagator` implementieren.
8. `propagate_satellite` implementieren.
9. `extract_global_track` implementieren.
10. `VisibilityEventHandler` und `attach_visibility_detectors` implementieren.
11. `extract_overpass_profile` implementieren.
12. `build_overpass_block` implementieren.
13. `build_result_metadata` implementieren.
14. `run_orekit_engine` zusammensetzen.


## Anmerkung für Schritt 3

Für die Code-Implementierung nutzen wir den Kontext aus Schritt 1 und 2, um den code verständlich zu kommentieren. Code-Kommentare sollen in englisch verfasst sein. Gleichzeitig gelten weiterhin die folgenden Implementierungsregeln:

- Optimale Leserlichkeit: Lieber mehr code und verständlich, als kompakt und unleserlich
- klar verständliche Variablennamen, 
- klare bzw. verständliche Code-Struktur
