package main

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// draw.io diagrams render to SVG here, so they show without the draw.io
// viewer (several megabytes, and loaded from the internet). Shapes, text,
// containers and connectors come out right; draw.io's rarer stencils show
// as boxes. Every shape carries data-cell-id and data-label, so a click on
// it says which shape it was.

const (
	maxDrawioBytes = 20 << 20
	maxDrawioCells = 20000
)

type drawioPage struct {
	Name string `json:"name"`
	SVG  string `json:"svg"`
}

type xmlNode struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Nodes   []xmlNode  `xml:",any"`
	Text    string     `xml:",chardata"`
}

func (n xmlNode) attr(name string) string {
	for _, a := range n.Attrs {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func (n xmlNode) child(name string) *xmlNode {
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == name {
			return &n.Nodes[i]
		}
	}
	return nil
}

// drawioPages renders every page of a diagram.
func drawioPages(data []byte) ([]drawioPage, error) {
	if len(data) > maxDrawioBytes {
		return nil, fmt.Errorf("the diagram is larger than %d MB", maxDrawioBytes>>20)
	}
	var root xmlNode
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("not draw.io XML: %v", err)
	}
	var pages []drawioPage
	switch root.XMLName.Local {
	case "mxGraphModel":
		svg, err := renderDrawioModel(root)
		if err != nil {
			return nil, err
		}
		pages = append(pages, drawioPage{Name: "Page-1", SVG: svg})
	case "mxfile":
		for i, diagram := range root.Nodes {
			if diagram.XMLName.Local != "diagram" {
				continue
			}
			name := diagram.attr("name")
			if name == "" {
				name = fmt.Sprintf("Page-%d", i+1)
			}
			model := diagram.child("mxGraphModel")
			if model == nil {
				decoded, err := inflateDrawio(diagram.Text)
				if err != nil {
					return nil, fmt.Errorf("page %s: %v", name, err)
				}
				var m xmlNode
				d := xml.NewDecoder(strings.NewReader(decoded))
				d.Strict = false
				if err := d.Decode(&m); err != nil || m.XMLName.Local != "mxGraphModel" {
					return nil, fmt.Errorf("page %s: not a diagram", name)
				}
				model = &m
			}
			svg, err := renderDrawioModel(*model)
			if err != nil {
				return nil, fmt.Errorf("page %s: %v", name, err)
			}
			pages = append(pages, drawioPage{Name: name, SVG: svg})
			if len(pages) >= 50 {
				break
			}
		}
	default:
		return nil, errors.New("not draw.io XML: expected <mxfile> or <mxGraphModel>")
	}
	if len(pages) == 0 {
		return nil, errors.New("the diagram has no pages")
	}
	return pages, nil
}

// inflateDrawio decodes a compressed page: base64 of raw deflate of the
// URI-encoded XML.
func inflateDrawio(text string) (string, error) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "<") {
		return text, nil
	}
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return "", fmt.Errorf("compressed page: %v", err)
	}
	inflated, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(raw)), maxDrawioBytes+1))
	if err != nil {
		return "", fmt.Errorf("compressed page: %v", err)
	}
	if len(inflated) > maxDrawioBytes {
		return "", errors.New("compressed page is too large")
	}
	if decoded, err := url.PathUnescape(string(inflated)); err == nil {
		return decoded, nil
	}
	return string(inflated), nil
}

type drawioPoint struct{ X, Y float64 }

type drawioCell struct {
	ID, Parent, Value, Style, Source, Target string
	Vertex, Edge, Hidden                     bool
	X, Y, W, H                               float64
	Relative                                 bool
	Points                                   []drawioPoint
	SourcePoint, TargetPoint, Offset         *drawioPoint
	styles                                   map[string]string
	shape                                    string
}

func parseDrawioStyle(style string) (map[string]string, string) {
	styles := map[string]string{}
	shape := ""
	for _, part := range strings.Split(style, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			if shape == "" {
				shape = part
			}
			styles[part] = "1"
			continue
		}
		styles[key] = value
	}
	if s := styles["shape"]; s != "" {
		shape = s
	}
	return styles, strings.ToLower(shape)
}

func parseFloat(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

func pointOf(n xmlNode) drawioPoint {
	return drawioPoint{parseFloat(n.attr("x")), parseFloat(n.attr("y"))}
}

func collectDrawioCells(root xmlNode) []*drawioCell {
	var cells []*drawioCell
	var add func(n xmlNode, wrapper *xmlNode)
	add = func(n xmlNode, wrapper *xmlNode) {
		if len(cells) >= maxDrawioCells {
			return
		}
		switch n.XMLName.Local {
		case "UserObject", "object":
			if inner := n.child("mxCell"); inner != nil {
				add(*inner, &n)
			}
			return
		case "mxCell":
		default:
			return
		}
		c := &drawioCell{ID: n.attr("id"), Parent: n.attr("parent"), Value: n.attr("value"), Style: n.attr("style"), Source: n.attr("source"), Target: n.attr("target")}
		if wrapper != nil {
			c.ID = wrapper.attr("id")
			c.Value = wrapper.attr("label")
		}
		c.Vertex, c.Edge = n.attr("vertex") == "1", n.attr("edge") == "1"
		c.Hidden = n.attr("visible") == "0"
		if geo := n.child("mxGeometry"); geo != nil {
			c.X, c.Y = parseFloat(geo.attr("x")), parseFloat(geo.attr("y"))
			c.W, c.H = parseFloat(geo.attr("width")), parseFloat(geo.attr("height"))
			c.Relative = geo.attr("relative") == "1"
			for _, child := range geo.Nodes {
				switch {
				case child.XMLName.Local == "mxPoint" && child.attr("as") == "sourcePoint":
					p := pointOf(child)
					c.SourcePoint = &p
				case child.XMLName.Local == "mxPoint" && child.attr("as") == "targetPoint":
					p := pointOf(child)
					c.TargetPoint = &p
				case child.XMLName.Local == "mxPoint" && child.attr("as") == "offset":
					p := pointOf(child)
					c.Offset = &p
				case child.XMLName.Local == "Array" && child.attr("as") == "points":
					for _, point := range child.Nodes {
						if point.XMLName.Local == "mxPoint" {
							c.Points = append(c.Points, pointOf(point))
						}
					}
				}
			}
		}
		c.styles, c.shape = parseDrawioStyle(c.Style)
		cells = append(cells, c)
	}
	for _, n := range root.Nodes {
		add(n, nil)
	}
	return cells
}

type drawioRect struct{ X, Y, W, H float64 }

func (r drawioRect) center() drawioPoint { return drawioPoint{r.X + r.W/2, r.Y + r.H/2} }

var drawioTagPattern = regexp.MustCompile(`(?is)<[^>]*>`)
var drawioNamedColor = regexp.MustCompile(`^[a-zA-Z]+$`)
var drawioBreakPattern = regexp.MustCompile(`(?i)<br\s*/?>|</div>|</p>|</li>|</h[1-6]>`)

// drawioLabel turns a label, plain or HTML, into lines of text.
func drawioLabel(value string, htmlLabel bool) string {
	if htmlLabel || strings.Contains(value, "<") {
		value = drawioBreakPattern.ReplaceAllString(value, "\n")
		value = drawioTagPattern.ReplaceAllString(value, "")
	}
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, " ", " ")
	lines := strings.Split(value, "\n")
	var out []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}

func drawioColor(value, fallback string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "":
		return fallback
	case "none":
		return "none"
	case "default":
		return fallback
	}
	if strings.HasPrefix(value, "#") || strings.HasPrefix(value, "rgb") || drawioNamedColor.MatchString(value) {
		return value
	}
	return fallback
}

func attrEscape(s string) string {
	var b strings.Builder
	xml.EscapeText(&b, []byte(s))
	return strings.ReplaceAll(b.String(), `"`, "&#34;")
}

func num(f float64) string { return strconv.FormatFloat(math.Round(f*100)/100, 'f', -1, 64) }

func renderDrawioModel(model xmlNode) (string, error) {
	root := model.child("root")
	if root == nil {
		return "", errors.New("the diagram has no root")
	}
	cells := collectDrawioCells(*root)
	byID := map[string]*drawioCell{}
	for _, c := range cells {
		if c.ID != "" {
			byID[c.ID] = c
		}
	}
	// Positions inside a container are relative to it.
	offsets := map[string]drawioPoint{}
	var offsetOf func(id string, depth int) drawioPoint
	offsetOf = func(id string, depth int) drawioPoint {
		if p, ok := offsets[id]; ok {
			return p
		}
		c := byID[id]
		if c == nil || !c.Vertex || depth > 50 {
			return drawioPoint{}
		}
		parent := offsetOf(c.Parent, depth+1)
		p := drawioPoint{parent.X + c.X, parent.Y + c.Y}
		offsets[id] = p
		return p
	}
	bounds := map[string]drawioRect{}
	for _, c := range cells {
		if c.Vertex && !c.Relative {
			p := offsetOf(c.ID, 0)
			bounds[c.ID] = drawioRect{p.X, p.Y, c.W, c.H}
		}
	}
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	grow := func(p drawioPoint) {
		minX, minY = math.Min(minX, p.X), math.Min(minY, p.Y)
		maxX, maxY = math.Max(maxX, p.X), math.Max(maxY, p.Y)
	}
	var body strings.Builder
	markers := map[string]bool{}
	edgeMid := map[string]drawioPoint{}
	for _, c := range cells {
		if c.Hidden || (!c.Vertex && !c.Edge) {
			continue
		}
		if c.Edge {
			points := edgePath(c, byID, bounds, offsetOf)
			if len(points) < 2 {
				continue
			}
			for _, p := range points {
				grow(p)
			}
			edgeMid[c.ID] = polylineMidpoint(points)
			body.WriteString(renderDrawioEdge(c, points, markers))
			continue
		}
		if c.Relative {
			// A label sitting on a connector.
			if mid, ok := edgeMid[c.Parent]; ok {
				label := drawioLabel(c.Value, c.styles["html"] == "1")
				if label != "" {
					x, y := mid.X, mid.Y
					if c.Offset != nil {
						x, y = x+c.Offset.X, y+c.Offset.Y
					}
					fmt.Fprintf(&body, `<g class="cell" data-cell-id="%s" data-label="%s">%s</g>`, attrEscape(c.ID), attrEscape(label), drawioText(label, drawioRect{x - 60, y - 10, 120, 20}, c.styles, true))
				}
			}
			continue
		}
		r := bounds[c.ID]
		if r.W <= 0 && r.H <= 0 {
			continue
		}
		grow(drawioPoint{r.X, r.Y})
		grow(drawioPoint{r.X + r.W, r.Y + r.H})
		body.WriteString(renderDrawioVertex(c, r))
	}
	if math.IsInf(minX, 1) {
		minX, minY, maxX, maxY = 0, 0, 100, 60
	}
	const pad = 12
	minX, minY, maxX, maxY = minX-pad, minY-pad, maxX+pad, maxY+pad
	width, height := maxX-minX, maxY-minY
	background := drawioColor(model.attr("background"), "#ffffff")
	if background == "none" {
		background = "#ffffff"
	}
	var out strings.Builder
	fmt.Fprintf(&out, `<svg xmlns="http://www.w3.org/2000/svg" class="drawio" viewBox="%s %s %s %s" width="%s" height="%s" font-family="Helvetica, Arial, sans-serif">`, num(minX), num(minY), num(width), num(height), num(width), num(height))
	if len(markers) > 0 {
		out.WriteString("<defs>")
		colors := make([]string, 0, len(markers))
		for color := range markers {
			colors = append(colors, color)
		}
		sort.Strings(colors)
		for _, color := range colors {
			fmt.Fprintf(&out, `<marker id="%s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="%s"/></marker>`, markerID(color), attrEscape(color))
		}
		out.WriteString("</defs>")
	}
	fmt.Fprintf(&out, `<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>`, num(minX), num(minY), num(width), num(height), attrEscape(background))
	out.WriteString(body.String())
	out.WriteString("</svg>")
	return out.String(), nil
}

func markerID(color string) string {
	var b strings.Builder
	b.WriteString("arrow-")
	for _, r := range color {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func renderDrawioVertex(c *drawioCell, r drawioRect) string {
	s := c.styles
	label := drawioLabel(c.Value, s["html"] == "1")
	textOnly := c.shape == "text" || s["text"] == "1"
	fill := drawioColor(s["fillColor"], "#ffffff")
	stroke := drawioColor(s["strokeColor"], "#000000")
	if textOnly {
		fill, stroke = drawioColor(s["fillColor"], "none"), drawioColor(s["strokeColor"], "none")
	}
	strokeWidth := parseFloat(s["strokeWidth"])
	if strokeWidth <= 0 {
		strokeWidth = 1
	}
	paint := fmt.Sprintf(` fill="%s" stroke="%s" stroke-width="%s"`, attrEscape(fill), attrEscape(stroke), num(strokeWidth))
	if s["dashed"] == "1" {
		paint += ` stroke-dasharray="6 4"`
	}
	if opacity := s["opacity"]; opacity != "" {
		paint += fmt.Sprintf(` opacity="%s"`, num(parseFloat(opacity)/100))
	}
	var shape string
	x, y, w, h := r.X, r.Y, r.W, r.H
	textBox := r
	switch {
	case textOnly:
		shape = fmt.Sprintf(`<rect x="%s" y="%s" width="%s" height="%s"%s/>`, num(x), num(y), num(w), num(h), paint)
	case c.shape == "ellipse" || c.shape == "doubleellipse":
		shape = fmt.Sprintf(`<ellipse cx="%s" cy="%s" rx="%s" ry="%s"%s/>`, num(x+w/2), num(y+h/2), num(w/2), num(h/2), paint)
	case c.shape == "rhombus":
		shape = fmt.Sprintf(`<polygon points="%s,%s %s,%s %s,%s %s,%s"%s/>`, num(x+w/2), num(y), num(x+w), num(y+h/2), num(x+w/2), num(y+h), num(x), num(y+h/2), paint)
	case c.shape == "triangle":
		shape = fmt.Sprintf(`<polygon points="%s,%s %s,%s %s,%s"%s/>`, num(x), num(y), num(x+w), num(y+h/2), num(x), num(y+h), paint)
	case c.shape == "hexagon":
		d := w * 0.25
		shape = fmt.Sprintf(`<polygon points="%s,%s %s,%s %s,%s %s,%s %s,%s %s,%s"%s/>`, num(x+d), num(y), num(x+w-d), num(y), num(x+w), num(y+h/2), num(x+w-d), num(y+h), num(x+d), num(y+h), num(x), num(y+h/2), paint)
	case c.shape == "parallelogram":
		d := w * 0.2
		shape = fmt.Sprintf(`<polygon points="%s,%s %s,%s %s,%s %s,%s"%s/>`, num(x+d), num(y), num(x+w), num(y), num(x+w-d), num(y+h), num(x), num(y+h), paint)
	case strings.HasPrefix(c.shape, "cylinder") || c.shape == "datastore":
		ry := math.Min(h*0.15, 15)
		shape = fmt.Sprintf(`<path d="M%s,%s a%s,%s 0 0,0 %s,0 v%s a%s,%s 0 0,1 -%s,0 z M%s,%s a%s,%s 0 0,1 %s,0 a%s,%s 0 0,1 -%s,0"%s/>`,
			num(x), num(y+ry), num(w/2), num(ry), num(w), num(h-2*ry), num(w/2), num(ry), num(w),
			num(x), num(y+ry), num(w/2), num(ry), num(w), num(w/2), num(ry), num(w), paint)
		textBox = drawioRect{x, y + 2*ry, w, h - 2*ry}
	case c.shape == "swimlane":
		start := parseFloat(s["startSize"])
		if start <= 0 {
			start = 23
		}
		shape = fmt.Sprintf(`<rect x="%s" y="%s" width="%s" height="%s"%s/><line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s"/>`, num(x), num(y), num(w), num(h), paint, num(x), num(y+start), num(x+w), num(y+start), attrEscape(stroke))
		textBox = drawioRect{x, y, w, start}
	case c.shape == "actor" || c.shape == "umlactor":
		head := math.Min(w, h) * 0.25
		cx := x + w/2
		shape = fmt.Sprintf(`<g%s fill="none"><circle cx="%s" cy="%s" r="%s"/><path d="M%s,%s V%s M%s,%s H%s M%s,%s L%s,%s M%s,%s L%s,%s"/></g>`, paint,
			num(cx), num(y+head), num(head), num(cx), num(y+2*head), num(y+h*0.7), num(x), num(y+h*0.4), num(x+w), num(cx), num(y+h*0.7), num(x), num(y+h), num(cx), num(y+h*0.7), num(x+w), num(y+h))
		textBox = drawioRect{x - 20, y + h + 2, w + 40, 16}
	case c.shape == "image" || s["image"] != "":
		if src := s["image"]; strings.HasPrefix(src, "data:image/") {
			// draw.io writes data:image/png,base64 without the semicolon.
			src = strings.Replace(src, ",base64,", ";base64,", 1)
			shape = fmt.Sprintf(`<image x="%s" y="%s" width="%s" height="%s" href="%s" preserveAspectRatio="xMidYMid meet"/>`, num(x), num(y), num(w), num(h), attrEscape(src))
		} else {
			shape = fmt.Sprintf(`<rect x="%s" y="%s" width="%s" height="%s" fill="#f4f4f4" stroke="#999" stroke-dasharray="4 3"/>`, num(x), num(y), num(w), num(h))
		}
		textBox = drawioRect{x - 20, y + h + 2, w + 40, 16}
	default:
		rx := 0.0
		if s["rounded"] == "1" {
			arc := parseFloat(s["arcSize"])
			if arc <= 0 {
				arc = 15
			}
			rx = math.Min(w, h) * arc / 100
			if s["absoluteArcSize"] == "1" {
				rx = arc / 2
			}
		}
		shape = fmt.Sprintf(`<rect x="%s" y="%s" width="%s" height="%s" rx="%s"%s/>`, num(x), num(y), num(w), num(h), num(rx), paint)
	}
	return fmt.Sprintf(`<g class="cell" data-cell-id="%s" data-label="%s">%s%s</g>`, attrEscape(c.ID), attrEscape(label), shape, drawioText(label, textBox, s, false))
}

func drawioText(label string, r drawioRect, s map[string]string, halo bool) string {
	if label == "" || s["noLabel"] == "1" {
		return ""
	}
	size := parseFloat(s["fontSize"])
	if size <= 0 {
		size = 12
	}
	color := drawioColor(s["fontColor"], "#000000")
	var lines []string
	wrap := s["whiteSpace"] == "wrap"
	maxChars := int(math.Max(4, (r.W-8)/(size*0.55)))
	for _, line := range strings.Split(label, "\n") {
		if !wrap || len([]rune(line)) <= maxChars {
			lines = append(lines, line)
			continue
		}
		var current string
		for _, word := range strings.Fields(line) {
			if current != "" && len([]rune(current))+1+len([]rune(word)) > maxChars {
				lines = append(lines, current)
				current = word
				continue
			}
			if current != "" {
				current += " "
			}
			current += word
		}
		if current != "" {
			lines = append(lines, current)
		}
	}
	lineHeight := size * 1.2
	anchor, x := "middle", r.X+r.W/2
	switch s["align"] {
	case "left":
		anchor, x = "start", r.X+4
	case "right":
		anchor, x = "end", r.X+r.W-4
	}
	total := lineHeight * float64(len(lines))
	y := r.Y + (r.H-total)/2 + size
	switch s["verticalAlign"] {
	case "top":
		y = r.Y + 4 + size
	case "bottom":
		y = r.Y + r.H - total - 4 + size
	}
	style := ""
	if fs := int(parseFloat(s["fontStyle"])); fs&1 != 0 {
		style += ` font-weight="bold"`
	} else if fs&2 != 0 {
		style += ` font-style="italic"`
	}
	if halo {
		style += ` stroke="#ffffff" stroke-width="3" paint-order="stroke"`
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<text x="%s" y="%s" font-size="%s" fill="%s" text-anchor="%s"%s>`, num(x), num(y), num(size), attrEscape(color), anchor, style)
	for i, line := range lines {
		dy := "0"
		if i > 0 {
			dy = num(lineHeight)
		}
		fmt.Fprintf(&b, `<tspan x="%s" dy="%s">%s</tspan>`, num(x), dy, attrEscape(line))
	}
	b.WriteString("</text>")
	return b.String()
}

// edgePath is the connector's points from source to target, ends clipped
// to the shapes they join.
func edgePath(c *drawioCell, byID map[string]*drawioCell, bounds map[string]drawioRect, offsetOf func(string, int) drawioPoint) []drawioPoint {
	base := offsetOf(c.Parent, 0)
	shift := func(p drawioPoint) drawioPoint { return drawioPoint{p.X + base.X, p.Y + base.Y} }
	var waypoints []drawioPoint
	for _, p := range c.Points {
		waypoints = append(waypoints, shift(p))
	}
	srcRect, hasSrc := bounds[c.Source]
	dstRect, hasDst := bounds[c.Target]
	var start, end drawioPoint
	switch {
	case hasSrc:
		start = srcRect.center()
	case c.SourcePoint != nil:
		start = shift(*c.SourcePoint)
	default:
		return nil
	}
	switch {
	case hasDst:
		end = dstRect.center()
	case c.TargetPoint != nil:
		end = shift(*c.TargetPoint)
	default:
		return nil
	}
	if len(waypoints) == 0 && strings.Contains(c.styles["edgeStyle"], "orthogonal") && start.X != end.X && start.Y != end.Y {
		if math.Abs(end.X-start.X) >= math.Abs(end.Y-start.Y) {
			mid := (start.X + end.X) / 2
			waypoints = []drawioPoint{{mid, start.Y}, {mid, end.Y}}
		} else {
			mid := (start.Y + end.Y) / 2
			waypoints = []drawioPoint{{start.X, mid}, {end.X, mid}}
		}
	}
	points := append([]drawioPoint{start}, waypoints...)
	points = append(points, end)
	if hasSrc {
		points[0] = clipToShape(srcRect, byID[c.Source], points[1])
	}
	if hasDst {
		points[len(points)-1] = clipToShape(dstRect, byID[c.Target], points[len(points)-2])
	}
	return points
}

// clipToShape is where the line from the shape's centre towards toward
// leaves the shape.
func clipToShape(r drawioRect, cell *drawioCell, toward drawioPoint) drawioPoint {
	center := r.center()
	dx, dy := toward.X-center.X, toward.Y-center.Y
	if dx == 0 && dy == 0 || r.W <= 0 || r.H <= 0 {
		return center
	}
	if cell != nil && (cell.shape == "ellipse" || cell.shape == "doubleellipse") {
		a, b := r.W/2, r.H/2
		t := 1 / math.Sqrt(dx*dx/(a*a)+dy*dy/(b*b))
		return drawioPoint{center.X + dx*t, center.Y + dy*t}
	}
	if cell != nil && cell.shape == "rhombus" {
		t := 1 / (math.Abs(dx)/(r.W/2) + math.Abs(dy)/(r.H/2))
		return drawioPoint{center.X + dx*t, center.Y + dy*t}
	}
	t := math.Min(r.W/2/math.Max(math.Abs(dx), 1e-9), r.H/2/math.Max(math.Abs(dy), 1e-9))
	if t > 1 {
		t = 1
	}
	return drawioPoint{center.X + dx*t, center.Y + dy*t}
}

func polylineMidpoint(points []drawioPoint) drawioPoint {
	total := 0.0
	for i := 1; i < len(points); i++ {
		total += math.Hypot(points[i].X-points[i-1].X, points[i].Y-points[i-1].Y)
	}
	half := total / 2
	for i := 1; i < len(points); i++ {
		seg := math.Hypot(points[i].X-points[i-1].X, points[i].Y-points[i-1].Y)
		if half <= seg && seg > 0 {
			f := half / seg
			return drawioPoint{points[i-1].X + (points[i].X-points[i-1].X)*f, points[i-1].Y + (points[i].Y-points[i-1].Y)*f}
		}
		half -= seg
	}
	return points[len(points)/2]
}

func renderDrawioEdge(c *drawioCell, points []drawioPoint, markers map[string]bool) string {
	s := c.styles
	stroke := drawioColor(s["strokeColor"], "#000000")
	if stroke == "none" {
		return ""
	}
	width := parseFloat(s["strokeWidth"])
	if width <= 0 {
		width = 1
	}
	var d strings.Builder
	for i, p := range points {
		if i == 0 {
			fmt.Fprintf(&d, "M%s,%s", num(p.X), num(p.Y))
		} else {
			fmt.Fprintf(&d, " L%s,%s", num(p.X), num(p.Y))
		}
	}
	extra := ""
	if s["dashed"] == "1" {
		extra += ` stroke-dasharray="6 4"`
	}
	if end := s["endArrow"]; end != "none" {
		markers[stroke] = true
		extra += fmt.Sprintf(` marker-end="url(#%s)"`, markerID(stroke))
	}
	if start := s["startArrow"]; start != "" && start != "none" {
		markers[stroke] = true
		extra += fmt.Sprintf(` marker-start="url(#%s)"`, markerID(stroke))
	}
	label := drawioLabel(c.Value, s["html"] == "1")
	text := ""
	if label != "" {
		mid := polylineMidpoint(points)
		text = drawioText(label, drawioRect{mid.X - 80, mid.Y - 10, 160, 20}, s, true)
	}
	// A wide invisible stroke makes thin connectors easy to click.
	return fmt.Sprintf(`<g class="cell edge" data-cell-id="%s" data-label="%s"><path d="%s" fill="none" stroke="transparent" stroke-width="10"/><path d="%s" fill="none" stroke="%s" stroke-width="%s"%s/>%s</g>`,
		attrEscape(c.ID), attrEscape(label), d.String(), d.String(), attrEscape(stroke), num(width), extra, text)
}
