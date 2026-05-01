/**
 * @file icons.tsx
 * Re-export of lucide icons used across the Smart Contacts UI, plus theme swatch indicator.
 * Rules: keep this file as a pure re-export barrel + ThemeSwatch component only.
 * Do not add business logic here.
 */
export {
  Search,
  Plus,
  Settings,
  Sun,
  Moon,
  Star,
  Trash2,
  Cake,
  Clock,
  Tag,
  Users,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Filter,
  AlertTriangle,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Globe,
  MessageSquare,
  Heart,
  Bell,
  X,
  Check,
  Edit3,
  Inbox,
  RotateCcw,
  RefreshCw,
  HardDrive,
  ScrollText,
  Copy,
  Download,
  Upload,
  Info,
  Keyboard,
  Eye,
  EyeOff,
  Lock,
  ListChecks,
  CalendarClock,
} from 'lucide-react'

// Two-color swatch indicator for theme picker.
import type { CSSProperties } from 'react'

export function ThemeSwatch({ colors, size = 14 }: { colors: readonly string[]; size?: number }) {
  const style: CSSProperties = {
    display: 'inline-flex',
    borderRadius: '50%',
    overflow: 'hidden',
    width: size,
    height: size,
    border: '1px solid rgba(0,0,0,.15)',
    flexShrink: 0,
  }
  const dot: CSSProperties = { flex: 1, height: '100%' }
  return (
    <span style={style}>
      {colors.map((c, i) => (
        <span key={i} style={{ ...dot, background: c }} />
      ))}
    </span>
  )
}
