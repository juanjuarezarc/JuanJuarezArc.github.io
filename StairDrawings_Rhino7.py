# -*- coding: utf-8 -*-
"""
StairDrawings for Rhino 7 (IronPython 2.7)
DS 1030 | 3A Studio FA26

Makes a one-sheet drawing set of a stair configuration:
  TOP VIEW    plan with overall width / length dimensions
  FRONT VIEW  elevation with floor datums (heavy dash), intermediate landing
              datums (light dash), and height dimension strings
  AXON VIEW   45 degree plan oblique inside a dashed bounding box
Solids are drawn solid black with white visible edges. Output is a vector PDF.

SET UP THE MODEL
  Draw one horizontal line at each level on these layers:
    DATUM FLOOR     floor levels        -> heavy dashed datums
    DATUM LANDING   intermediate landings -> light dashed datums
  Line length and position do not matter; only the height is used.
  Each drawn datum copies the linetype of its input line (by layer or by
  object). Continuous input lines get the default dashes.
  (The first run adds these two layers if the file does not have them.)

HOW TO RUN
  Rhino 7 > Tools > PythonScript > Edit (EditPythonScript), open this file,
  press Run (green arrow).
  Or type:  _-RunPythonScript "path\\to\\StairDrawings_Rhino7.py"
  1. Select the stair solids and its datum lines.
  2. Choose where to save the PDF.

  If no datum lines are selected, every datum line in the file is used.
  If there are no floor lines at all, the script asks for floor levels
  (e.g. 0, 11'-6", 23) and finds the landings from the geometry.

DIMENSIONS use the annotation style "STAIR DRAWINGS" (created on first run
with the studio defaults: Arial 2 mm, 3 mm rectangle arrows, text in line,
feet-inches to 1/4"). Edit it in Options > Annotation Styles; re-runs keep
your edits. Sizes are in the file's layout units (Document Properties >
Units > Layout units) and are converted if a file uses different ones.
The Model space scale is set by the script on every run; leave it alone.

Each run makes a numbered drawing in the model (layer "STAIR DRAWINGS",
grouped as "STAIR DRAWING 01", 02, ...) with its own layout of the same name.
New drawings are placed in a row to the right of the existing ones.
Running again on a stair that already has a drawing replaces only that
drawing, in place. To start a drawing over, delete its group and re-run.
"""

from __future__ import division, print_function

import json
import math
import os
import re

import System
import Rhino
import Rhino.Geometry as rg
import Rhino.DocObjects as rd
from System.Drawing import Color

# ---------------------------------------------------------------- settings --
SCALE_FT_PER_IN = 8.0      # drawing scale: 1/8" = 1'-0" (1 inch on paper = 8 feet)
PAGE_MARGIN_IN = 0.25      # white margin between page edge and frame
FRAME_OFFSET_FT = 6.0      # frame sits this far (real feet) outside the views
VIEW_GAP_FT = 20.0         # clear space between axon / top view / front view
AXON_ROTATION_DEG = 45.0   # plan rotation for the axon
AXON_HEIGHT_FACTOR = 1.0   # 1.0 = verticals drawn at true height
LANDING_MIN_FT = 2.5       # flat tops narrower than this are treads
LEVEL_TOL_FT = 0.25        # landing this close to a floor counts as the floor
LAYER_ROOT = "STAIR DRAWINGS"
PAGE_PREFIX = "STAIR DRAWING "  # layouts are named STAIR DRAWING 01, 02, ...
DRAWING_GAP_FT = 6.0            # space between drawings placed side by side
REG_SECTION = "StairDrawings"   # document strings: one entry per drawing
STYLE_SECTION = "StairDrawings.Style"  # document strings: annotation style stamps
TAG_KEY = "StairDrawings.Drawing"  # user string on every drawn object
DIMSTYLE_NAME = "STAIR DRAWINGS"
FONT = "Arial"

# annotation style defaults (millimetres on the printed sheet). Used only when
# the file has no "STAIR DRAWINGS" style; edit that style in Rhino's
# Annotation Styles panel to change dimensions for a file.
DIM_TEXT_MM = 2.0
DIM_ARROW_MM = 3.0            # rectangle arrowheads
DIM_GAP_MM = 1.0
DIM_EXT_OFFSET_MM = 1.0
DIM_EXT_EXTENSION_MM = 0.0
LABEL_MM = 5.0                # view labels (TOP VIEW etc.)
STYLE_KEY = "StairDrawings.StyleVersion"
STYLE_VERSION = "5"           # bump to reset every file's style to the defaults
PAGE_UNITS_KEY = "StairDrawings.PageUnits"
DIMSTYLE_LENGTHS = ("TextHeight", "ArrowLength", "TextGap", "ExtensionLineOffset",
                    "ExtensionLineExtension", "DimensionLineExtension", "BaselineSpacing",
                    "MaskOffset", "LeaderArrowLength", "FixedExtensionLength",
                    "CentermarkSize", "LeaderLandingLength")

# paper sizes (inches on the printed sheet)
# Datum lines copy the linetype of the matching input datum line. These are
# the fallbacks (name, [dash, gap, ...] in mm on the printed sheet), used when
# an input line is Continuous or the levels were typed in.
LT_FLOOR = ("STAIR DATUM FLOOR", [2.5, 1.25])
LT_LANDING = ("STAIR DATUM LANDING", [0.9, 0.9])
LT_BBOX = ("STAIR BOUNDING BOX", [3.0, 2.0])

# layer: (display color, print color, print width mm)
LAYERS = {
    "FILL":           (Color.Black, Color.Black, 0.0),
    "EDGES":          (Color.White, Color.White, 0.18),
    "FLOOR LINES":    (Color.Black, Color.Black, 0.35),
    "LANDING LINES":  (Color.Black, Color.Black, 0.13),
    "BOUNDING BOX":   (Color.Black, Color.Black, 0.13),
    "DIMENSIONS":     (Color.Black, Color.Black, 0.13),
    "TEXT":           (Color.Black, Color.Black, 0.13),
    "FRAME":          (Color.Black, Color.Black, 0.25),
}


# ------------------------------------------------------------------ units --
def ft_to_model(doc):
    return Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Feet, doc.ModelUnitSystem)


def fmt_ftin(ft):
    sign = "-" if ft < -1e-9 else ""
    total_in = int(round(abs(ft) * 12.0))
    return "{}{}'-{}\"".format(sign, total_in // 12, total_in % 12)


def parse_len_ft(token):
    """'11.5' | 11'-6" | 11' 6" | 11' | 138" -> feet (float)."""
    t = token.strip().replace(u"\u2032", "'").replace(u"\u2033", '"')
    if not t:
        raise ValueError("empty value")
    neg = t.startswith("-")
    if neg:
        t = t[1:].strip()
    m = re.match(r"(\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:\"|in)?)?\Z", t)
    if m:
        v = float(m.group(1)) + float(m.group(2) or 0) / 12.0
    else:
        m = re.match(r"(\d+(?:\.\d+)?)\s*(?:\"|in)\Z", t)
        v = float(m.group(1)) / 12.0 if m else float(t)
    return -v if neg else v


def parse_levels(text):
    return sorted(parse_len_ft(tok) for tok in re.split(r"[,;]", text) if tok.strip())


# --------------------------------------------------------------- geometry --
def collect_breps(rhino_objects):
    out = []
    for o in rhino_objects:
        if isinstance(o, rd.InstanceObject):
            out.extend(collect_breps(o.GetSubObjects()))
            continue
        g = o.Geometry
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Brep):
            out.append(g.DuplicateBrep())
    return out


def union_bbox(geoms):
    bb = rg.BoundingBox.Empty
    for g in geoms:
        bb = rg.BoundingBox.Union(bb, g.GetBoundingBox(True))
    return bb


def xf_front():
    """View from the south looking north: x'=x, y'=z, z'=-y."""
    t = rg.Transform.Identity
    t.M11 = 0.0
    t.M12 = 1.0
    t.M21 = -1.0
    t.M22 = 0.0
    return t


def xf_axon(center):
    """Plan oblique: rotate plan, then push geometry up the sheet by its height."""
    rot = rg.Transform.Rotation(math.radians(AXON_ROTATION_DEG), rg.Vector3d.ZAxis, center)
    sh = rg.Transform.Identity
    sh.M12 = AXON_HEIGHT_FACTOR
    return sh * rot


def transformed(breps, xf):
    out = []
    for b in breps:
        d = b.DuplicateBrep()
        d.Transform(xf)
        out.append(d)
    return out


def visible_edges(breps, tol):
    """Make2D from the top (looking down -Z); returns flattened visible curves."""
    bb = union_bbox(breps)
    c = bb.Center
    diag = max(bb.Diagonal.Length, 1.0)
    vp = rd.ViewportInfo()
    vp.ChangeToParallelProjection(True)
    vp.SetCameraLocation(rg.Point3d(c.X, c.Y, bb.Max.Z + diag))
    vp.SetCameraDirection(-rg.Vector3d.ZAxis)
    vp.SetCameraUp(rg.Vector3d.YAxis)
    half = 0.6 * max(bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y) + 0.05 * diag
    vp.ScreenPort = System.Drawing.Rectangle(0, 0, 2000, 2000)
    vp.SetFrustum(-half, half, -half, half, 0.01 * diag, 4.0 * diag)

    p = rg.HiddenLineDrawingParameters()
    p.AbsoluteTolerance = tol
    p.Flatten = True
    # computing hidden curves too gives a more complete set of visible ones
    p.IncludeHiddenCurves = True
    p.IncludeTangentEdges = False
    p.IncludeTangentSeams = False
    p.SetViewport(vp)
    for b in breps:
        p.AddGeometry(b, rg.Transform.Identity, None)
    hld = rg.HiddenLineDrawing.Compute(p, True)
    curves = []
    if hld is None:
        return curves
    # output is centred on the camera; move it back to world XY and flatten
    to_world = rg.Transform.Translation(c.X, c.Y, 0)
    flat = rg.Transform.PlanarProjection(rg.Plane.WorldXY)
    vis = rg.HiddenLineDrawingSegment.Visibility.Visible
    for s in hld.Segments:
        if s.SegmentVisibility != vis:
            continue
        crv = s.CurveGeometry
        if crv is None:
            continue
        crv = crv.DuplicateCurve()
        crv.Transform(flat)
        crv.Transform(to_world)
        if crv.GetLength() > tol:
            curves.append(crv)
    return curves


def view_mesh(breps):
    mp = rg.MeshingParameters.QualityRenderMesh
    mp.SimplePlanes = True
    mesh = rg.Mesh()
    for b in breps:
        for m in list(rg.Mesh.CreateFromBrep(b, mp) or []):
            mesh.Append(m)
    return mesh


def _simple_loops(crv, tol):
    """Split a closed loop that crosses itself into simple closed loops."""
    x = rg.Intersect.Intersection.CurveSelf(crv, tol)
    if not x or x.Count == 0:
        return [crv]
    try:
        reg = rg.Curve.CreateBooleanRegions([crv], rg.Plane.WorldXY, True, tol)
        out = []
        for i in range(reg.RegionCount):
            out.extend(c for c in reg.RegionCurves(i) if c.IsClosed)
        if out:
            return out
    except Exception:
        pass
    return []  # could not untangle: drop it (the coverage check decides)


def silhouette_loops(breps, tol, mesh=None):
    """Closed, non-self-intersecting outline loops of the geometry seen from
    the top (outer boundaries and holes), from the mesh outline."""
    mesh = mesh or view_mesh(breps)
    outlines = mesh.GetOutlines(rg.Plane.WorldXY) if mesh.Vertices.Count else None
    clean_tol = max(10 * tol, 1e-6)
    loops = []
    for pl in outlines or []:
        pl = rg.Polyline(pl)
        pl.DeleteShortSegments(clean_tol)          # micro-segments cause the knots
        pl.MergeColinearSegments(0.1 * math.pi / 180.0, True)
        if pl.Count < 4:
            continue
        if not pl.IsClosed:
            pl.Add(pl[0])
        crv = rg.PolylineCurve(pl)
        crv.Transform(rg.Transform.PlanarProjection(rg.Plane.WorldXY))
        if crv.GetLength() <= tol:
            continue
        for c in _simple_loops(crv, tol):
            amp = rg.AreaMassProperties.Compute(c)
            if amp is not None and amp.Area > clean_tol * clean_tol:
                loops.append(c)
    return loops


def fill_covers(hatches, mesh, tol, samples=400):
    """True if the hatches cover the view: points on upward-facing mesh faces
    (the ones seen from above) must all fall inside the fill."""
    if not hatches:
        return False
    regions = [(h.GetBoundingBox(True), [c for c in list(h.Get3dCurves(True)) + list(h.Get3dCurves(False))])
               for h in hatches]
    mesh.FaceNormals.ComputeFaceNormals()
    ids = [i for i in range(mesh.Faces.Count) if mesh.FaceNormals[i].Z > 0.05]
    if not ids:
        return True
    step = max(1, len(ids) // samples)
    misses = checked = 0
    inside = rg.PointContainment.Inside
    for i in ids[::step]:
        c = mesh.Faces.GetFaceCenter(i)
        p = rg.Point3d(c.X, c.Y, 0)
        checked += 1
        hit = False
        for bb, crvs in regions:
            if not bb.Contains(p):
                continue
            n = sum(1 for crv in crvs if crv.Contains(p, rg.Plane.WorldXY, tol) == inside)
            if n % 2 == 1:
                hit = True
                break
        if not hit:
            misses += 1
    return misses <= max(1, 0.01 * checked)


def face_loops(breps, tol):
    """Fallback fill: every face boundary projected to the XY plane."""
    proj = rg.Transform.PlanarProjection(rg.Plane.WorldXY)
    groups = []
    for b in breps:
        for f in b.Faces:
            crvs = []
            for lp in f.Loops:
                c = lp.To3dCurve()
                if c is None:
                    continue
                c.Transform(proj)
                crvs.append(c)
            if crvs:
                groups.append(crvs)
    return groups


def landing_levels(breps, ft, tol):
    """Elevations of upward-facing flat tops wide enough to be landings."""
    min_w = LANDING_MIN_FT * ft
    levels = []
    for b in breps:
        for f in b.Faces:
            if not f.IsPlanar(tol):
                continue
            ok, pl = f.TryGetPlane(tol)
            if not ok:
                continue
            n = pl.Normal
            if f.OrientationIsReversed:
                n = -n
            if n.Z < 0.99:
                continue
            outer = f.OuterLoop.To3dCurve()
            if outer is None:
                continue
            segs = list(outer.DuplicateSegments() or []) or [outer]
            longest = max(segs, key=lambda s: s.GetLength())
            xdir = longest.PointAtEnd - longest.PointAtStart
            xdir.Z = 0.0
            if not xdir.Unitize():
                xdir = rg.Vector3d.XAxis
            ydir = rg.Vector3d.CrossProduct(rg.Vector3d.ZAxis, xdir)
            fpl = rg.Plane(pl.Origin, xdir, ydir)
            bb = outer.GetBoundingBox(fpl)
            if min(bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y) >= min_w:
                levels.append(pl.Origin.Z)
    levels.sort()
    merged = []
    for z in levels:
        if not merged or z - merged[-1] > 0.05 * ft:
            merged.append(z)
    return merged


DATUM_LAYER_NAMES = {
    "floor":   ("DATUM FLOOR", "DATUM FLOORS", "FLOOR DATUM", "FLOOR DATUMS"),
    "landing": ("DATUM LANDING", "DATUM LANDINGS", "LANDING DATUM", "LANDING DATUMS"),
}


def _norm(name):
    return " ".join(name.upper().replace("_", " ").replace("-", " ").split())


def datum_kind(doc, obj):
    """'floor' / 'landing' if obj sits on a student datum layer, else None.
    Matches the layer name at any depth; ignores this script's own output."""
    lay = doc.Layers[obj.Attributes.LayerIndex]
    if lay.FullPath.upper().startswith(LAYER_ROOT):
        return None
    n = _norm(lay.Name)
    for kind, names in DATUM_LAYER_NAMES.items():
        if n in names:
            return kind
    return None


def datum_levels(doc, objs, linetypes=None):
    """Elevations (model units) of curves on the datum layers.
    If a dict is passed as `linetypes`, it is filled with
    {elevation: linetype index} taken from each datum line (its effective
    linetype, whether set by object, layer or parent layer)."""
    tol = doc.ModelAbsoluteTolerance
    out = {"floor": [], "landing": []}
    for o in objs:
        if o is None or o.IsDeleted or not isinstance(o.Geometry, rg.Curve):
            continue
        kind = datum_kind(doc, o)
        if kind is None:
            continue
        c = o.Geometry
        z0, z1 = c.PointAtStart.Z, c.PointAtEnd.Z
        if abs(z1 - z0) > 10 * tol:
            print("StairDrawings: a datum line is not level; using its average height.")
        out[kind].append((0.5 * (z0 + z1), doc.Linetypes.LinetypeIndexForObject(o)))
    merged = {}
    for kind, items in out.items():
        items.sort(key=lambda t: t[0])
        m = []
        for z, lt in items:
            if not m or z - m[-1] > 10 * tol:
                m.append(z)
                if linetypes is not None:
                    linetypes[z] = lt
        merged[kind] = m
    return merged["floor"], merged["landing"]


def ensure_datum_layers(doc):
    """Create DATUM FLOOR / DATUM LANDING if the file has no such layers."""
    created = []
    existing = set(_norm(l.Name) for l in doc.Layers if not l.IsDeleted
                   and not l.FullPath.upper().startswith(LAYER_ROOT))
    for kind, color in (("floor", Color.Red), ("landing", Color.Blue)):
        if not existing.intersection(DATUM_LAYER_NAMES[kind]):
            lay = rd.Layer()
            lay.Name = DATUM_LAYER_NAMES[kind][0]
            lay.Color = color
            doc.Layers.Add(lay)
            created.append(lay.Name)
    return created


def ensure_linetype(doc, name, pattern_mm):
    """Index of linetype `name`, creating it (sheet-scaled dashes) if missing.
    An existing linetype of that name is left as the user set it."""
    lt = doc.Linetypes.FindName(name)
    if lt is not None and not lt.IsDeleted and lt.Index >= 0:
        return lt.Index
    new = rd.Linetype()
    new.Name = name
    for i, length in enumerate(pattern_mm):
        new.AppendSegment(length, i % 2 == 0)  # dash, gap, dash, gap ...
    return doc.Linetypes.Add(new)


# ------------------------------------------------------------- doc helpers --
def ensure_layers(doc):
    root = doc.Layers.FindName(LAYER_ROOT)
    if root is None:
        lay = rd.Layer()
        lay.Name = LAYER_ROOT
        doc.Layers.Add(lay)
        root = doc.Layers.FindName(LAYER_ROOT)
    idx = {}
    for name, (col, pcol, pw) in LAYERS.items():
        full = LAYER_ROOT + "::" + name
        i = doc.Layers.FindByFullPath(full, -1)
        if i < 0:
            lay = rd.Layer()
            lay.Name = name
            lay.ParentLayerId = root.Id
            i = doc.Layers.Add(lay)
        lay = doc.Layers[i]
        lay.Color = col
        lay.PlotColor = pcol
        lay.PlotWeight = pw
        lay.IsVisible = True
        lay.IsLocked = False
        lay.CommitChanges()
        idx[name] = i
    return idx


_CURRENT_TAG = None  # drawing number stamped on objects created by build()


def attrs(layer_index, order=0):
    a = rd.ObjectAttributes()
    a.LayerIndex = layer_index
    a.DisplayOrder = order
    a.Space = rd.ActiveSpace.ModelSpace  # never on a layout, even if one is active
    if _CURRENT_TAG:
        a.SetUserString(TAG_KEY, _CURRENT_TAG)
    return a


# ------------------------------------------------ drawing registry (per file) --
def tagged_objects(doc, num):
    return [o for o in doc.Objects if o.Attributes.GetUserString(TAG_KEY) == num]


def load_registry(doc):
    """{number: {"ids": [...], "frame": [minx, miny, maxx, maxy]}} for drawings
    that still exist in the file (entries whose drawing was deleted are dropped)."""
    reg = {}
    for num in list(doc.Strings.GetEntryNames(REG_SECTION) or []):
        try:
            data = json.loads(doc.Strings.GetValue(REG_SECTION, num))
        except Exception:
            data = None
        if data and tagged_objects(doc, num):
            reg[num] = data
        else:
            doc.Strings.Delete(REG_SECTION, num)
    return reg


def pick_drawing(reg, source_ids):
    """Number of the existing drawing made from any of these objects, else a new one."""
    ids = set(source_ids or [])
    if ids:
        for num, data in sorted(reg.items()):
            if ids & set(data.get("ids", [])):
                return num, True
    nxt = max([int(n) for n in reg if n.isdigit()] + [0]) + 1
    return "{:02d}".format(nxt), False


def _enum(owner, enum_name, member):
    """owner.enum_name.member, or None if this Rhino version lacks it."""
    try:
        return System.Enum.Parse(getattr(owner, enum_name), member)
    except Exception:
        return None


def _set(obj, prop, value):
    """Set obj.prop, skipping properties this Rhino version does not have."""
    if value is None:
        return
    try:
        setattr(obj, prop, value)
    except Exception as e:
        print("StairDrawings: annotation style setting {} skipped ({}).".format(prop, e))


def ensure_dimstyle(doc, model_scale):
    """Use the file's 'STAIR DRAWINGS' annotation style if it exists; otherwise
    create it with the studio defaults (sizes are millimetres on the sheet).
    Only the model-space scale is set on every run: Rhino shows annotation at
    its page size on layouts and at page size x model_scale in the model.
    The style's version and layout units are kept in the document strings
    (section STYLE_SECTION), since Rhino 7 styles cannot hold user text."""
    DS = rd.DimensionStyle
    existing = doc.DimStyles.FindName(DIMSTYLE_NAME)
    stamp = doc.Strings.GetValue(STYLE_SECTION, STYLE_KEY) if existing is not None else None
    # a style this version has not set up yet (made by an earlier version, or
    # left half-made by a run that stopped early) gets the studio defaults.
    # Once stamped, the style is kept as the user edits it.
    if existing is None or stamp != STYLE_VERSION:
        mm = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Millimeters, doc.PageUnitSystem)
        if existing is None:
            i = doc.DimStyles.Add(DIMSTYLE_NAME)
            ds = doc.DimStyles[i].Duplicate()
        else:
            ds = existing.Duplicate()
            print("StairDrawings: updated the old STAIR DRAWINGS annotation style.")
        _set(ds, "Font", rd.Font(FONT))
        _set(ds, "TextHeight", DIM_TEXT_MM * mm)
        _set(ds, "ArrowType1", _enum(DS, "ArrowType", "Rectangle"))
        _set(ds, "ArrowType2", _enum(DS, "ArrowType", "Rectangle"))
        _set(ds, "ArrowLength", DIM_ARROW_MM * mm)
        _set(ds, "TextGap", DIM_GAP_MM * mm)
        _set(ds, "ExtensionLineOffset", DIM_EXT_OFFSET_MM * mm)
        _set(ds, "ExtensionLineExtension", DIM_EXT_EXTENSION_MM * mm)
        _set(ds, "DimTextLocation", _enum(DS, "TextLocation", "InDimLine"))
        _set(ds, "DimTextOrientation", _enum(rd, "TextOrientation", "InPlane"))
        _set(ds, "DimTextAngleType", _enum(DS, "LeaderContentAngleStyle", "Aligned"))
        _set(ds, "DimensionLengthDisplay", _enum(DS, "LengthDisplay", "FeetAndInches"))
        _set(ds, "LengthResolution", 2)          # nearest 1/4"
        _set(ds, "ZeroSuppress", _enum(DS, "ZeroSuppression", "None"))
        _set(ds, "DrawTextMask", False)
    else:
        ds = existing.Duplicate()
        # sizes are stored in the layout units of the file the style was made
        # in; convert if this file's layout units differ (keeps user edits)
        old = doc.Strings.GetValue(STYLE_SECTION, PAGE_UNITS_KEY)
        if old and old != doc.PageUnitSystem.ToString():
            f = Rhino.RhinoMath.UnitScale(System.Enum.Parse(Rhino.UnitSystem, old), doc.PageUnitSystem)
            for prop in DIMSTYLE_LENGTHS:
                if hasattr(ds, prop):
                    _set(ds, prop, getattr(ds, prop) * f)
            print("StairDrawings: converted the annotation style from {} to {} layout units.".format(
                old, doc.PageUnitSystem))
    doc.Strings.SetString(STYLE_SECTION, STYLE_KEY, STYLE_VERSION)
    doc.Strings.SetString(STYLE_SECTION, PAGE_UNITS_KEY, doc.PageUnitSystem.ToString())
    _set(ds, "DimensionScale", model_scale)
    doc.DimStyles.Modify(ds, doc.DimStyles.FindName(DIMSTYLE_NAME).Id, True)
    return doc.DimStyles.FindName(DIMSTYLE_NAME)


# ----------------------------------------------------------------- build --
class View(object):
    def __init__(self, name, xf, breps, world_bb):
        self.name = name
        self.xf = xf
        self.breps = transformed(breps, xf)
        corners = world_bb.GetCorners()
        pts = []
        for c in corners:
            p = rg.Point3d(c)
            p.Transform(xf)
            pts.append(rg.Point3d(p.X, p.Y, 0))
        self.box_pts = pts  # view-space corners of the world bounding box
        bb = rg.BoundingBox(pts)
        self.minx, self.miny = bb.Min.X, bb.Min.Y
        self.w, self.h = bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y
        self.move = rg.Transform.Identity

    def place(self, x, y):
        """Put the view's lower-left corner at sheet point (x, y)."""
        self.move = rg.Transform.Translation(x - self.minx, y - self.miny, 0)
        self.x0, self.y0 = x, y

    def pt(self, vx, vy):
        p = rg.Point3d(vx, vy, 0)
        p.Transform(self.move)
        return p


def build(doc, breps, floors_ft, pdf_path=None, landings_ft=None, datum_linetypes=None,
          source_ids=None):
    """Main entry. breps: world geometry. floors_ft: floor levels in feet.
    landings_ft: intermediate landing levels in feet; None = find them from
    the geometry (flat tops at least LANDING_MIN_FT deep, between floors).
    datum_linetypes: {elevation (model units): linetype index} from the input
    datum lines; levels without one (or Continuous) use the defaults.
    source_ids: ids (str) of the selected stair objects. A drawing already made
    from any of them is replaced in place; otherwise a new drawing is added."""
    global _CURRENT_TAG
    tol = doc.ModelAbsoluteTolerance
    ft = ft_to_model(doc)
    floors = sorted(f * ft for f in floors_ft)
    world_bb = union_bbox(breps)

    if landings_ft is not None:
        landings = sorted(z * ft for z in landings_ft)
        inter = [z for z in landings if all(abs(z - f) > 0.01 * ft for f in floors)]
    else:
        landings = landing_levels(breps, ft, tol)
        inter = [z for z in landings
                 if all(abs(z - f) > LEVEL_TOL_FT * ft for f in floors)
                 and (not floors or floors[0] < z < floors[-1])]

    top = View("TOP VIEW", rg.Transform.Identity, breps, world_bb)
    front = View("FRONT VIEW", xf_front(), breps, world_bb)
    axon = View("AXON VIEW", xf_axon(world_bb.Center), breps, world_bb)

    # --- layout at the fixed drawing scale (same for every stair, so text,
    # dashes and spacing match when drawings are placed side by side)
    pad = FRAME_OFFSET_FT * ft  # frame offset from the views, in real feet
    k = SCALE_FT_PER_IN * ft    # model units per paper inch
    off1, off2 = 0.35 * k, 0.70 * k
    gap = VIEW_GAP_FT * ft       # clear space between the three drawings
    label_drop = 0.30 * k
    label_h = LABEL_MM / 25.4 * k
    # one column, top to bottom: AXON, TOP VIEW, FRONT VIEW, centred on a
    # common axis (top and front views share the stair's X extent).
    # Local coordinates: axis at x = 0, bottom of the front view at y = 0.
    loc = {"front": (-front.w / 2, 0.0)}
    loc["top"] = (-top.w / 2, front.h + gap)
    loc["axon"] = (-axon.w / 2, front.h + gap + top.h + gap)
    xmin = min(-top.w / 2, -front.w / 2, -axon.w / 2)
    xmax = max(top.w / 2 + off1 + 0.3 * k, front.w / 2 + off2 + 0.3 * k, axon.w / 2)
    ymin = -(label_drop + label_h)          # FRONT VIEW label under the front view
    ymax = loc["axon"][1] + axon.h
    content_w = xmax - xmin
    content_h = ymax - ymin

    # which drawing is this, and where does its frame go?
    #  - re-run on the same stair: same number, same frame corner
    #  - new stair: next number, to the right of the existing drawings
    #  - first drawing in the file: to the right of the stair
    reg = load_registry(doc)
    num, existed = pick_drawing(reg, [str(i) for i in (source_ids or [])])
    others = [d["frame"] for n, d in reg.items() if n != num and "frame" in d]
    if existed and "frame" in reg[num]:
        ox, oy = reg[num]["frame"][0], reg[num]["frame"][1]
    elif others:
        ox = max(f[2] for f in others) + DRAWING_GAP_FT * ft
        oy = min(f[1] for f in others)
    else:
        ox = world_bb.Max.X + max(world_bb.Diagonal.Length, 1.0)
        oy = world_bb.Min.Y
    frame_w = content_w + 2 * pad
    frame_h = content_h + 2 * pad
    dx, dy = ox + pad - xmin, oy + pad - ymin   # local -> model
    for v, key in ((top, "top"), (front, "front"), (axon, "axon")):
        v.place(loc[key][0] + dx, loc[key][1] + dy)

    # --- doc setup. Remove this drawing's old layout and make a model view
    # active FIRST: objects created while a layout is active belong to that
    # layout and are deleted with it. Then remove only this drawing's objects.
    page_name = PAGE_PREFIX + num
    remove_layout(doc, page_name)
    idx = ensure_layers(doc)
    for o in tagged_objects(doc, num):
        doc.Objects.Delete(o, True)
    _CURRENT_TAG = num
    ps = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Inches, doc.PageUnitSystem)
    model_per_page = k / ps
    ds = ensure_dimstyle(doc, model_per_page)
    hatch_i = doc.HatchPatterns.FindName("Solid")
    hatch_i = hatch_i.Index if hatch_i is not None else 0
    added = []

    def add_curve(c, layer, order=0):
        added.append(doc.Objects.AddCurve(c, attrs(idx[layer], order)))

    def add_line(l, layer, order=0):
        added.append(doc.Objects.AddLine(l, attrs(idx[layer], order)))

    default_lt = {"FLOOR LINES": ensure_linetype(doc, *LT_FLOOR),
                  "LANDING LINES": ensure_linetype(doc, *LT_LANDING),
                  "BOUNDING BOX": ensure_linetype(doc, *LT_BBOX)}
    lt_map = datum_linetypes or {}

    def linetype_for(z, layer):
        """Linetype of the input datum line at height z, else the default."""
        for zz, lt in lt_map.items():
            if abs(zz - z) <= 10 * tol and lt is not None and lt >= 0:
                return lt
        return default_lt[layer]

    def add_datum(curve, layer, z=None, order=-2):
        a = attrs(idx[layer], order)
        a.LinetypeSource = rd.ObjectLinetypeSource.LinetypeFromObject
        a.LinetypeIndex = linetype_for(z, layer) if z is not None else default_lt[layer]
        added.append(doc.Objects.AddCurve(curve, a))

    def add_text(s, pt, right=True):
        plane = rg.Plane(pt, rg.Vector3d.XAxis, rg.Vector3d.YAxis)
        te = rg.TextEntity.Create(s, plane, ds, False, 0, 0)
        te.TextHeight = LABEL_MM * Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Millimeters, doc.PageUnitSystem)
        te.DimensionScale = model_per_page
        te.TextHorizontalAlignment = rd.TextHorizontalAlignment.Right if right else rd.TextHorizontalAlignment.Left
        te.TextVerticalAlignment = rd.TextVerticalAlignment.Top
        added.append(doc.Objects.AddText(te, attrs(idx["TEXT"])))

    def add_dim(p1, p2, line_pt, vertical):
        d = rg.LinearDimension.Create(
            rg.AnnotationType.Rotated, ds, rg.Plane.WorldXY, rg.Vector3d.XAxis,
            p1, p2, line_pt, math.pi / 2 if vertical else 0.0)
        if d is not None:
            added.append(doc.Objects.AddLinearDimension(d, attrs(idx["DIMENSIONS"])))

    # --- black fill + white edges for each view
    for v in (top, front, axon):
        mesh = view_mesh(v.breps)
        loops = silhouette_loops(v.breps, tol, mesh)
        hatches = []
        if loops:
            hatches = [h for h in (rg.Hatch.Create(loops, hatch_i, 0.0, 1.0, tol) or []) if h.IsValid]
        if not fill_covers(hatches, mesh, tol):
            # outline failed: one hatch per face (exact, just more objects)
            print("StairDrawings: {} outline incomplete; filling face by face.".format(v.name))
            hatches = []
            for grp in face_loops(v.breps, tol):
                hatches.extend(h for h in (rg.Hatch.Create(grp, hatch_i, 0.0, 1.0, tol) or []) if h.IsValid)
        for h in hatches:
            h.Transform(v.move)
            added.append(doc.Objects.AddHatch(h, attrs(idx["FILL"], -1)))
        for c in visible_edges(v.breps, tol):
            c.Transform(v.move)
            add_curve(c, "EDGES", 1)

    # --- top view dimensions
    x0, x1 = top.minx, top.minx + top.w
    y0, y1 = top.miny, top.miny + top.h
    add_dim(top.pt(x0, y0), top.pt(x1, y0), top.pt(x0, y0 - off1), False)
    add_dim(top.pt(x1, y0), top.pt(x1, y1), top.pt(x1 + off1, y0), True)
    add_text(top.name, top.pt(x1, y0 - off1 - 0.3 * k))

    # --- front view datums + dimensions
    fx0, fx1 = front.minx, front.minx + front.w
    for z in floors:
        add_datum(rg.LineCurve(front.pt(fx0, z), front.pt(fx1 + off2, z)), "FLOOR LINES", z)
    for z in inter:
        add_datum(rg.LineCurve(front.pt(fx0, z), front.pt(fx1 + off1, z)), "LANDING LINES", z)
    for a, b in zip(floors, floors[1:]):
        add_dim(front.pt(fx1 + off2, a), front.pt(fx1 + off2, b), front.pt(fx1 + off2, a), True)
        chain = [a] + [z for z in inter if a < z < b]
        if len(chain) > 1:
            for p, q in zip(chain, chain[1:]):
                add_dim(front.pt(fx1 + off1, p), front.pt(fx1 + off1, q), front.pt(fx1 + off1, p), True)
    add_text(front.name, front.pt(fx1, front.miny) + rg.Vector3d(0, -label_drop, 0))

    # --- axon: datums as level outlines of the bounding box
    def axon_ring(z):
        pts = []
        for x, y in ((world_bb.Min.X, world_bb.Min.Y), (world_bb.Max.X, world_bb.Min.Y),
                     (world_bb.Max.X, world_bb.Max.Y), (world_bb.Min.X, world_bb.Max.Y)):
            p = rg.Point3d(x, y, z)
            p.Transform(axon.xf)
            p = rg.Point3d(p.X, p.Y, 0)
            p.Transform(axon.move)
            pts.append(p)
        return pts

    for zs, layer in ((floors, "FLOOR LINES"), (inter, "LANDING LINES")):
        for z in zs:
            r = axon_ring(z)
            add_datum(rg.PolylineCurve(r + [r[0]]), layer, z)

    # --- axon bounding box: only when there are no datums to imply it
    c = axon.box_pts
    edges = []
    if not floors and not inter:
        edges = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4),
                 (0, 4), (1, 5), (2, 6), (3, 7)]
    for i, j in edges:
        p, q = rg.Point3d(c[i]), rg.Point3d(c[j])
        p.Transform(axon.move)
        q.Transform(axon.move)
        if p.DistanceTo(q) > tol:
            add_datum(rg.LineCurve(p, q), "BOUNDING BOX")
    add_text(axon.name, rg.Point3d(axon.x0 + axon.w, axon.y0 - label_drop, 0))

    # --- sheet frame
    frame = rg.Rectangle3d(rg.Plane.WorldXY, rg.Point3d(ox, oy, 0), rg.Point3d(ox + frame_w, oy + frame_h, 0))
    add_curve(frame.ToNurbsCurve(), "FRAME")

    _CURRENT_TAG = None
    ids = [i for i in added if i != System.Guid.Empty]
    if ids:
        doc.Groups.Add("STAIR DRAWING " + num, ids)

    # remember which stair this drawing came from and where its frame is
    prev_ids = reg.get(num, {}).get("ids", []) if existed else []
    doc.Strings.SetString(REG_SECTION, num, json.dumps({
        "ids": sorted(set(prev_ids) | set(str(i) for i in (source_ids or []))),
        "frame": [ox, oy, ox + frame_w, oy + frame_h]}))

    frame_bb = rg.BoundingBox(rg.Point3d(ox, oy, 0), rg.Point3d(ox + frame_w, oy + frame_h, 0))
    page = make_layout(doc, frame_bb, k, page_name)
    if pdf_path:
        export_pdf(doc, page, pdf_path)
    doc.Views.Redraw()
    return {"drawing": num, "replaced": existed,
            "floors": floors, "intermediate": inter, "landings": landings,
            "frame": (frame_w, frame_h), "sheet_in": (frame_w / k + 2 * PAGE_MARGIN_IN, frame_h / k + 2 * PAGE_MARGIN_IN),
            "objects": len(ids)}


def remove_layout(doc, page_name):
    """Close the named layout and make a model viewport the active view."""
    for pv in list(doc.Views.GetPageViews()):
        if pv.PageName == page_name:
            pv.Close()
    active = doc.Views.ActiveView
    if active is None or isinstance(active, Rhino.Display.RhinoPageView):
        for v in doc.Views.GetViewList(True, False):  # model views only
            doc.Views.ActiveView = v
            break


def make_layout(doc, frame_bb, k, page_name):
    """Layout sized to the frame at k model units per paper inch."""
    remove_layout(doc, page_name)
    ps = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Inches, doc.PageUnitSystem)
    fw = frame_bb.Max.X - frame_bb.Min.X
    fh = frame_bb.Max.Y - frame_bb.Min.Y
    m = PAGE_MARGIN_IN * ps
    pw = fw / k * ps + 2 * m
    ph = fh / k * ps + 2 * m
    page = doc.Views.AddPageView(page_name, pw, ph)
    det = page.AddDetailView("SHEET", rg.Point2d(m, m), rg.Point2d(pw - m, ph - m),
                             Rhino.Display.DefinedViewportProjection.Top)
    if det is not None:
        vp = det.Viewport
        c = frame_bb.Center
        z = max(fw, fh)
        vp.ZoomBoundingBox(frame_bb)
        vp.SetCameraLocations(rg.Point3d(c.X, c.Y, 0.0), rg.Point3d(c.X, c.Y, z))
        det.CommitViewportChanges()
        det.DetailGeometry.SetScale(k, doc.ModelUnitSystem, ps, doc.PageUnitSystem)
        det.CommitViewportChanges()
        vp.SetCameraLocations(rg.Point3d(c.X, c.Y, 0.0), rg.Point3d(c.X, c.Y, z))
        det.CommitViewportChanges()
        det.DetailGeometry.IsProjectionLocked = True
        a = det.Attributes.Duplicate()
        a.PlotWeightSource = rd.ObjectPlotWeightSource.PlotWeightFromObject
        a.PlotWeight = -1.0  # do not print the detail border
        doc.Objects.ModifyAttributes(det, a, True)
        det.CommitChanges()
    page.SetPageAsActive()
    page.Redraw()
    return page


def export_pdf(doc, page, path):
    settings = Rhino.Display.ViewCaptureSettings(page, 300)
    settings.RasterMode = False
    settings.OutputColor = Rhino.Display.ViewCaptureSettings.ColorMode.DisplayColor
    pdf = Rhino.FileIO.FilePdf.Create()
    pdf.AddPage(settings)
    pdf.Write(path)


# ------------------------------------------------------------ user prompt --
def main():
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    doc = sc.doc

    created = ensure_datum_layers(doc)
    if created:
        print("StairDrawings: added layers " + " and ".join(created) +
              ". Draw a horizontal line on them at each floor / landing level.")

    ids = rs.GetObjects("Select the stair (solids + datum lines)",
                        filter=4 | 8 | 16 | 4096 | 1073741824, preselect=True)
    if not ids:
        return
    objs = [doc.Objects.FindId(i) for i in ids]
    breps = collect_breps(objs)
    if not breps:
        print("StairDrawings: no solids or polysurfaces selected.")
        return

    ft = ft_to_model(doc)
    # datum lines: the selected ones, or else every datum line in the file
    lts = {}
    floor_z, landing_z = datum_levels(doc, objs, lts)
    if not floor_z and not landing_z:
        floor_z, landing_z = datum_levels(doc, list(doc.Objects), lts)
        if floor_z or landing_z:
            print("StairDrawings: no datum lines selected; using all datum lines in the file.")

    landings_ft = [z / ft for z in landing_z] if landing_z else None
    if floor_z:
        floors_ft = [z / ft for z in floor_z]
    else:
        # fallback: ask for floor heights
        found_ft = [z / ft for z in landing_levels(breps, ft, doc.ModelAbsoluteTolerance)]
        print("StairDrawings: no lines on the DATUM FLOOR layer.")
        if found_ft:
            print("Landing tops found at: " + ", ".join(fmt_ftin(z) for z in found_ft))
        default = ", ".join(fmt_ftin(z) for z in (found_ft[:1] + found_ft[-1:])) if found_ft else "0"
        text = rs.GetString("Floor levels in feet, comma separated (e.g. 0, 11'-6\", 23)", default)
        if not text:
            return
        try:
            floors_ft = parse_levels(text)
        except Exception as e:
            print("StairDrawings: could not read floor levels ({}).".format(e))
            return

    folder = os.path.dirname(doc.Path) if doc.Path else os.path.join(os.path.expanduser("~"), "Desktop")
    name = (os.path.splitext(doc.Name)[0] if doc.Name else "Stair") + "_Drawings.pdf"
    pdf = rs.SaveFileName("Save drawing set", "PDF (*.pdf)|*.pdf||", folder, name)

    stair_ids = [o.Id for o in objs if o is not None and datum_kind(doc, o) is None
                 and not isinstance(o.Geometry, rg.Curve)]
    info = build(doc, breps, floors_ft, pdf, landings_ft, lts, stair_ids)
    print("StairDrawings: {} drawing {} (layout {}{})".format(
        "updated" if info["replaced"] else "created", info["drawing"], PAGE_PREFIX, info["drawing"]))
    print("StairDrawings: floors {} | intermediate landings {}".format(
        ", ".join(fmt_ftin(z / ft) for z in info["floors"]),
        ", ".join(fmt_ftin(z / ft) for z in info["intermediate"]) or "none"))
    if pdf:
        print("StairDrawings: saved " + pdf)


if __name__ == "__main__":
    main()
