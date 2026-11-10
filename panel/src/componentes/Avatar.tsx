// Avatar con las iniciales y un degradado elegido a partir del nombre (siempre el mismo para la misma persona).
const degradados = [
  'from-coral to-rosa',
  'from-rosa to-violeta',
  'from-violeta to-cian',
  'from-cian to-menta',
  'from-ambar to-coral',
  'from-menta to-cian',
]

function iniciales(nombre: string) {
  // Array.from separa por caracteres reales, así un emoji al principio del nombre no se parte por la mitad.
  const partes = nombre.trim().split(/\s+/).filter(Boolean).map((p) => Array.from(p))
  const letras = partes.length > 1 ? partes[0][0] + partes[1][0] : (partes[0] ?? ['?']).slice(0, 2).join('')
  return letras.toUpperCase()
}

function indice(nombre: string) {
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % degradados.length
}

export function Avatar({ nombre, enEspera = false }: { nombre: string; enEspera?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative grid size-10 shrink-0 place-items-center rounded-2xl bg-linear-to-br text-sm font-bold text-white ${degradados[indice(nombre)]}`}
    >
      {iniciales(nombre)}
      {enEspera && (
        <span className="absolute -top-0.5 -right-0.5 size-3 animate-latido rounded-full border-2 border-white bg-ambar text-ambar" />
      )}
    </span>
  )
}
