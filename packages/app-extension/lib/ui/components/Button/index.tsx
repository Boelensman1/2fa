import type { ButtonHTMLAttributes, FC } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:hover:bg-blue-300',
  secondary:
    'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400',
  danger:
    'bg-white text-red-600 border border-red-300 hover:bg-red-50 disabled:text-red-300',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/**
 * The one button in the extension.
 *
 * A component rather than a repeated class string: unlike `../app-browser`,
 * which has a handful of screens that each set their own look, this popup puts
 * buttons in a 380px column where any drift between them is obvious.
 */
const Button: FC<ButtonProps> = ({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`w-full rounded-md px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    {...rest}
  />
)

export default Button
