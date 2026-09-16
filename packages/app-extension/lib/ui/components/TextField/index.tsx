import type { FC, InputHTMLAttributes } from 'react'
import { useId } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

const TextField: FC<TextFieldProps> = ({ label, hint, ...rest }) => {
  const id = useId()

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-gray-700"
      >
        {label}
      </label>
      <input
        id={id}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        {...rest}
      />
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  )
}

export default TextField
