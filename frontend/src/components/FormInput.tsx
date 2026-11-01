export default function FormInput({
  label, value, onChange, required = false, type = 'text', disabled = false
}: {
  label: string; value: string; onChange: (value: string) => void;
  required?: boolean; type?: string; disabled?: boolean
}) {
  return <label>
    {label}
    <input type={type} value={value} onChange={(event) => onChange(event.target.value)}
      required={required} disabled={disabled} />
  </label>;
}
