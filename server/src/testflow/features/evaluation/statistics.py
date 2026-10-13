"""Consistent applicable-dimension denominators for reports and the workspace."""
def complete_dimensions(profile, result=None):
    dimensions = list((result or {}).get("dimensions", []))
    present = {dimension["id"] for dimension in dimensions}
    dimensions.extend({"id": dimension["id"], "needs_reference": dimension["needs_reference"],
                       "applicable": True, "state": "unscored"}
                      for dimension in profile["data"]["dimensions"] if dimension["id"] not in present)
    return dimensions


def dimension_rates(dimensions, needs_reference):
    applicable = [d for d in dimensions if d["needs_reference"] == needs_reference and d["applicable"]]
    valid = [d for d in applicable if d["state"] in {"pass", "fail"}]
    passed = sum(d["state"] == "pass" for d in valid)
    return {"expected": len(applicable), "valid": len(valid), "passed": passed,
            "pass_rate": passed / len(valid) if valid else None,
            "coverage": len(valid) / len(applicable) if applicable else None}
