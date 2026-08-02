from __future__ import annotations
import json
import random
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))
from agents.thermal_agent.db import AdjacencyRecord, BuildingRecord, FloorRecord, RoomRecord
from agents.thermal_agent.zone_model import ZoneModelSanityError, build_zone_model
PORT = 8765
DIRECTIONS = ('north', 'south', 'east', 'west')

def _random_room() -> dict:
    total_floors = random.choice([2, 3, 3, 4, 5])
    floor_level = random.randint(1, total_floors)
    area_m2 = round(random.uniform(25.0, 60.0), 1)
    volume_m3 = round(area_m2 * random.uniform(2.7, 3.3), 1)
    ext_count = random.choice([1, 1, 1, 2])
    ext_dirs = set(random.sample(DIRECTIONS, ext_count))
    walls = {d: round(random.uniform(14.0, 26.0), 1) for d in DIRECTIONS}
    return {'area_m2': area_m2, 'volume_m3': volume_m3, 'r_wall': round(random.uniform(1.2, 2.4), 2), 'window_u_value': round(random.uniform(1.4, 5.8), 2), 'thermal_mass': random.choice(['heavy', 'light']), 'floor_level': floor_level, 'total_floors': total_floors, 'walls': walls, 'external_directions': sorted(ext_dirs)}

def _compute(payload: dict) -> dict:
    room = RoomRecord(room_id='test-room', floor_id='test-floor', building_id='test-building', room_label='Test Room', room_type='classroom', area_m2=float(payload['area_m2']), volume_m3=float(payload['volume_m3']), primary_orientation=None, r_wall=float(payload['r_wall']), c_zone=float(payload['volume_m3']) * 1206.0, sensor_id='test-sensor', config_json={'envelope': {f'{d}_wall_m2': float(payload['walls'][d]) for d in DIRECTIONS}, 'thermal': {'window_u_value': float(payload['window_u_value']), 'thermal_mass': payload['thermal_mass']}})
    floor = FloorRecord(floor_id='test-floor', building_id='test-building', level=int(payload['floor_level']), name=None)
    building = BuildingRecord(building_id='test-building', name='Test Building', latitude=0.0, longitude=0.0, total_floors=int(payload['total_floors']), country_code='XX')
    external = set(payload['external_directions'])
    adjacencies = [AdjacencyRecord('test-room', None, d, 'external' if d in external else 'internal') for d in DIRECTIONS]
    try:
        model = build_zone_model(room, floor, building, adjacencies)
        return {'ok': True, 'r_lumped_k_per_w': model.r_lumped_k_per_w, 'c_lumped_j_per_k': model.c_lumped_j_per_k, 'tau_hours': model.tau_hours, 'ua_wall_w_per_k': model.ua_wall_w_per_k, 'ua_window_w_per_k': model.ua_window_w_per_k, 'ua_roof_w_per_k': model.ua_roof_w_per_k, 'ua_vent_w_per_k': model.ua_vent_w_per_k, 'is_top_floor': model.is_top_floor, 'c_zone_air_only': room.c_zone}
    except (ZoneModelSanityError, ValueError) as exc:
        return {'ok': False, 'error': str(exc)}
HTML_PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>zone_model.py test UI</title>\n<style>\n  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }\n  h1 { font-size: 1.3rem; }\n  p.note { color: #555; font-size: 0.9rem; }\n  fieldset { border: 1px solid #ccc; border-radius: 6px; margin-bottom: 1rem; }\n  legend { font-weight: 600; padding: 0 0.4rem; }\n  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }\n  label { display: block; font-size: 0.8rem; color: #333; margin-top: 0.4rem; }\n  input, select { width: 100%; box-sizing: border-box; padding: 0.3rem; font-size: 0.9rem; }\n  .wall-row { display: flex; align-items: center; gap: 0.4rem; }\n  .wall-row input[type=checkbox] { width: auto; }\n  button { padding: 0.5rem 1rem; font-size: 0.9rem; margin-right: 0.5rem; cursor: pointer; }\n  table { border-collapse: collapse; margin-top: 1rem; width: 100%; }\n  td, th { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }\n  th { background: #f4f4f4; }\n  #result.ok { border-left: 4px solid #2a9d5c; padding-left: 0.8rem; }\n  #result.fail { border-left: 4px solid #c0392b; padding-left: 0.8rem; }\n  #error-msg { color: #c0392b; font-weight: 600; }\n</style>\n</head>\n<body>\n<h1>zone_model.py test UI</h1>\n<p class="note">\n  Runs the real <code>build_zone_model()</code> against whatever is in the form below.\n  Nothing here touches a database &mdash; data is generated client/server-side and discarded after each compute.\n</p>\n\n<div>\n  <button id="btn-random">Generate random room</button>\n  <button id="btn-compute">Compute</button>\n</div>\n\n<fieldset>\n  <legend>Room</legend>\n  <div class="grid">\n    <div><label>area_m2</label><input id="area_m2" type="number" step="0.1" value="45"></div>\n    <div><label>volume_m3</label><input id="volume_m3" type="number" step="0.1" value="135"></div>\n    <div><label>r_wall (m&sup2;&middot;K/W)</label><input id="r_wall" type="number" step="0.01" value="1.8"></div>\n    <div><label>window_u_value (W/m&sup2;&middot;K)</label><input id="window_u_value" type="number" step="0.01" value="5.8"></div>\n    <div><label>thermal_mass</label>\n      <select id="thermal_mass"><option value="heavy">heavy</option><option value="light">light</option></select>\n    </div>\n    <div><label>floor_level</label><input id="floor_level" type="number" step="1" value="1"></div>\n    <div><label>total_floors</label><input id="total_floors" type="number" step="1" value="3"></div>\n  </div>\n</fieldset>\n\n<fieldset>\n  <legend>Walls (area m&sup2; + faces outside?)</legend>\n  <div class="grid" id="walls-grid"></div>\n</fieldset>\n\n<div id="result"></div>\n\n<script>\nconst DIRECTIONS = ["north", "south", "east", "west"];\nconst wallsGrid = document.getElementById("walls-grid");\nDIRECTIONS.forEach(d => {\n  const div = document.createElement("div");\n  div.innerHTML = `\n    <label>${d}_wall_m2</label>\n    <input id="wall_${d}" type="number" step="0.1" value="18">\n    <div class="wall-row">\n      <input id="ext_${d}" type="checkbox">\n      <label style="margin:0">faces outside</label>\n    </div>`;\n  wallsGrid.appendChild(div);\n});\ndocument.getElementById("ext_south").checked = true;\n\nfunction readForm() {\n  return {\n    area_m2: document.getElementById("area_m2").value,\n    volume_m3: document.getElementById("volume_m3").value,\n    r_wall: document.getElementById("r_wall").value,\n    window_u_value: document.getElementById("window_u_value").value,\n    thermal_mass: document.getElementById("thermal_mass").value,\n    floor_level: document.getElementById("floor_level").value,\n    total_floors: document.getElementById("total_floors").value,\n    walls: Object.fromEntries(DIRECTIONS.map(d => [d, document.getElementById(`wall_${d}`).value])),\n    external_directions: DIRECTIONS.filter(d => document.getElementById(`ext_${d}`).checked),\n  };\n}\n\nfunction fillForm(room) {\n  document.getElementById("area_m2").value = room.area_m2;\n  document.getElementById("volume_m3").value = room.volume_m3;\n  document.getElementById("r_wall").value = room.r_wall;\n  document.getElementById("window_u_value").value = room.window_u_value;\n  document.getElementById("thermal_mass").value = room.thermal_mass;\n  document.getElementById("floor_level").value = room.floor_level;\n  document.getElementById("total_floors").value = room.total_floors;\n  DIRECTIONS.forEach(d => {\n    document.getElementById(`wall_${d}`).value = room.walls[d];\n    document.getElementById(`ext_${d}`).checked = room.external_directions.includes(d);\n  });\n}\n\ndocument.getElementById("btn-random").addEventListener("click", async () => {\n  const res = await fetch("/random");\n  fillForm(await res.json());\n});\n\ndocument.getElementById("btn-compute").addEventListener("click", async () => {\n  const res = await fetch("/compute", {\n    method: "POST",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify(readForm()),\n  });\n  const data = await res.json();\n  const out = document.getElementById("result");\n  if (!data.ok) {\n    out.className = "fail";\n    out.innerHTML = `<h3>Sanity gate rejected this room</h3><p id="error-msg">${data.error}</p>`;\n    return;\n  }\n  out.className = "ok";\n  out.innerHTML = `\n    <h3>Result</h3>\n    <table>\n      <tr><th>UA_wall (W/K)</th><td>${data.ua_wall_w_per_k.toFixed(3)}</td></tr>\n      <tr><th>UA_window (W/K)</th><td>${data.ua_window_w_per_k.toFixed(3)}</td></tr>\n      <tr><th>UA_roof (W/K)</th><td>${data.ua_roof_w_per_k.toFixed(3)}</td></tr>\n      <tr><th>UA_vent (W/K)</th><td>${data.ua_vent_w_per_k.toFixed(3)}</td></tr>\n      <tr><th>R_lumped (K/W)</th><td>${data.r_lumped_k_per_w.toFixed(5)}</td></tr>\n      <tr><th>c_zone air-only (J/K)</th><td>${data.c_zone_air_only.toLocaleString()}</td></tr>\n      <tr><th>C_lumped (J/K)</th><td>${data.c_lumped_j_per_k.toLocaleString()}</td></tr>\n      <tr><th>tau (hours)</th><td>${data.tau_hours.toFixed(2)}</td></tr>\n      <tr><th>is_top_floor</th><td>${data.is_top_floor}</td></tr>\n    </table>`;\n});\n</script>\n</body>\n</html>\n'

class Handler(BaseHTTPRequestHandler):

    def _send_json(self, obj: dict, status: int=200) -> None:
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == '/':
            body = HTML_PAGE.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/random':
            self._send_json(_random_room())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == '/compute':
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length))
            self._send_json(_compute(payload))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass

def main() -> None:
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'zone_model.py test UI: http://127.0.0.1:{PORT}  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
if __name__ == '__main__':
    main()
