use serde::Serialize;

/// Physical screen coordinates, including negative origins on secondary monitors.
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Bounds {
    pub fn from_edges(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    /// Keep a transient or invalid shell work area from placing a wallpaper
    /// outside its monitor or shrinking it to an empty window.
    pub fn clipped_to(self, monitor: Self) -> Self {
        let left = self.x.max(monitor.x);
        let top = self.y.max(monitor.y);
        let right = (self.x + self.width).min(monitor.x + monitor.width);
        let bottom = (self.y + self.height).min(monitor.y + monitor.height);
        if right > left && bottom > top {
            Self::from_edges(left, top, right, bottom)
        } else {
            monitor
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Bounds;

    #[test]
    fn reserves_the_taskbar_on_each_edge() {
        let monitor = Bounds::from_edges(0, 0, 1920, 1080);
        for (edges, expected) in [
            ((0, 0, 1920, 1032), (0, 0, 1920, 1032)),
            ((0, 48, 1920, 1080), (0, 48, 1920, 1032)),
            ((64, 0, 1920, 1080), (64, 0, 1856, 1080)),
            ((0, 0, 1856, 1080), (0, 0, 1856, 1080)),
        ] {
            let work = Bounds::from_edges(edges.0, edges.1, edges.2, edges.3);
            let bounds = work.clipped_to(monitor);
            assert_eq!((bounds.x, bounds.y, bounds.width, bounds.height), expected);
        }
    }

    #[test]
    fn keeps_secondary_monitor_offsets_and_physical_pixels() {
        // A 150% scaled monitor left of and above the primary display. Native
        // positioning must retain physical pixels rather than divide by DPI.
        let monitor = Bounds::from_edges(-2560, -360, 0, 1080);
        let work = Bounds::from_edges(-2560, -288, 0, 1080);
        assert_eq!(
            work.clipped_to(monitor),
            Bounds {
                x: -2560,
                y: -288,
                width: 2560,
                height: 1368,
            }
        );
        // A monitor with no reserved taskbar continues to use its entire area.
        assert_eq!(monitor.clipped_to(monitor), monitor);
    }

    #[test]
    fn clips_work_area_and_falls_back_for_empty_or_disjoint_rectangles() {
        let monitor = Bounds::from_edges(1920, 0, 3840, 1080);
        assert_eq!(
            Bounds::from_edges(0, 0, 4000, 1032).clipped_to(monitor),
            Bounds::from_edges(1920, 0, 3840, 1032)
        );
        for work in [
            Bounds::from_edges(0, 0, 0, 0),
            Bounds::from_edges(1920, 0, 1920, 1080),
            Bounds::from_edges(1920, 1080, 3840, 0),
            Bounds::from_edges(-1920, 0, 0, 1080),
        ] {
            assert_eq!(work.clipped_to(monitor), monitor);
        }
    }
}
