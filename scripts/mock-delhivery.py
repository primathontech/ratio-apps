#!/usr/bin/env python3
"""
Mock Delhivery Express B2C API — for local end-to-end testing WITHOUT creating
real shipments. Point the backend at it:  DELHIVERY_API_BASE=http://localhost:4500

Implements exactly the endpoints delhivery/sdk/sdk.service.ts calls:
  GET  /c/api/pin-codes/json/?filter_codes=PIN        -> serviceability + test-connection
  POST /api/backend/clientwarehouse/create/           -> warehouse registration
  POST /api/cmu/create.json                           -> manifestation (returns a fake AWB)
  GET  /waybill/api/bulk/json/?count=N                -> bulk waybill allocation
  GET  /api/p/packing_slip?wbns=AWB&pdf=true          -> label (points at /label.pdf here)
  GET  /label.pdf                                     -> a tiny valid PDF
  POST /fm/request/new/                               -> pickup request
  GET  /api/v1/packages/json/?waybill=AWB             -> tracking (ADVANCES per poll)
  POST /api/p/edit                                    -> cancel

Tracking simulates real progression: each time you poll a waybill it advances
Manifested -> In Transit -> Out for Delivery -> Delivered.
"""
import json, sys, time, datetime, random
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# per-waybill poll counter to advance tracking status
_poll = {}
_STAGES = [
    ("Manifested",        "UD", "Gurgaon_Bilaspur_HB (Haryana)"),
    ("In Transit",        "UD", "Gurgaon_Bilaspur_HB (Haryana)"),
    ("Out for Delivery",  "UD", "New Delhi_Kirtinagar_DC (Delhi)"),
    ("Delivered",         "DL", "New Delhi_Kirtinagar_DC (Delhi)"),
]

def now_iso():
    # fixed-ish timestamp (env forbids real clock in some tools, but this is a plain script)
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S.000+05:30")

class H(BaseHTTPRequestHandler):
    def _send(self, obj, code=200, ctype="application/json"):
        body = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _log(self, tag, extra=""):
        print(f"[mock-delhivery] {tag} {self.path.split('?')[0]} {extra}", flush=True)

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query); p = u.path

        if p == "/c/api/pin-codes/json/":
            pin = (q.get("filter_codes") or ["110001"])[0]
            self._log("serviceability", pin)
            # non-serviceable demo for pins starting with 9
            if pin.startswith("9"):
                return self._send({"delivery_codes": []})
            return self._send({"delivery_codes": [{"postal_code": {
                "pin": pin, "cod": "Y", "pre_paid": "Y", "cash": "Y",
                "district": "SIM District", "state_code": "DL"}}]})

        if p == "/waybill/api/bulk/json/":
            n = int((q.get("count") or ["1"])[0])
            self._log("bulk-waybill", f"count={n}")
            return self._send([f"SIM{random.randint(10**11, 10**12-1)}" for _ in range(n)])

        if p == "/api/p/packing_slip":
            awb = (q.get("wbns") or ["SIM"])[0]
            self._log("label", awb)
            return self._send({"packages": [{"pdf_download_link": "http://localhost:4500/label.pdf"}]})

        if p == "/label.pdf":
            self._log("label-pdf")
            pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
            return self._send(pdf, ctype="application/pdf")

        if p == "/api/v1/packages/json/":
            awb = (q.get("waybill") or ["SIM"])[0]
            n = _poll.get(awb, 0)
            stage_i = min(n, len(_STAGES) - 1)
            _poll[awb] = n + 1
            status, stype, loc = _STAGES[stage_i]
            self._log("track", f"{awb} -> {status} (poll {n})")
            scans = [{"ScanDetail": {"Scan": s[0], "ScanType": s[1], "ScannedLocation": s[2],
                                     "ScanDateTime": now_iso(), "Instructions": s[0]}}
                     for s in _STAGES[:stage_i]]
            return self._send({"ShipmentData": [{"Shipment": {
                "AWB": awb, "Status": {"Status": status, "StatusType": stype,
                                       "StatusLocation": loc, "StatusDateTime": now_iso()},
                "Scans": scans}}]})

        self._log("GET-unhandled")
        return self._send({"ok": True, "note": "mock: unhandled GET"}, 200)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        p = urlparse(self.path).path

        if p == "/api/backend/clientwarehouse/create/":
            self._log("warehouse-create")
            return self._send({"success": True, "data": {"message": "mock warehouse registered"}})

        if p == "/api/cmu/create.json":
            awb = f"SIM{random.randint(10**11, 10**12-1)}"
            # body is 'format=json&data={...}' — pull the order number for the log
            order = ""
            try:
                data = raw.split("data=", 1)[1]
                order = (json.loads(data).get("shipments") or [{}])[0].get("order", "")
            except Exception:
                pass
            self._log("MANIFEST", f"order={order} -> AWB {awb}")
            return self._send({"success": True, "packages": [{
                "waybill": awb, "status": "Success", "order": order,
                "refnum": order, "remarks": [], "client": "SIM-CLIENT",
                "sort_code": "DEL/KRT", "cod_amount": 0}]})

        if p == "/fm/request/new/":
            self._log("pickup-request")
            return self._send({"success": True, "pickup_id": random.randint(1000, 9999),
                               "pickup_date": now_iso()})

        if p == "/api/p/edit":
            self._log("cancel")
            return self._send({"success": True, "status": "cancelled"})

        self._log("POST-unhandled", raw[:80])
        return self._send({"success": True, "note": "mock: unhandled POST"}, 200)

    def log_message(self, *a): pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4500
    print(f"mock Delhivery listening on http://localhost:{port}  (Ctrl+C to stop)", flush=True)
    HTTPServer(("0.0.0.0", port), H).serve_forever()
