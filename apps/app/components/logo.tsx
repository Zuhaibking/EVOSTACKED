export type LogoStyle = 'evostack' | 'mark'

export default function Logo({
  style = 'evostack',
  ...props
}: { style?: LogoStyle } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="3"
        y="16"
        width="18"
        height="4"
        rx="1.25"
        fill="currentColor"
        opacity="0.35"
      />
      <rect
        x="5"
        y="10"
        width="14"
        height="4"
        rx="1.25"
        fill="currentColor"
        opacity="0.65"
      />
      <rect
        x="7"
        y="4"
        width="10"
        height="4"
        rx="1.25"
        fill="currentColor"
      />
    </svg>
  )
}
