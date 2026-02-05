import Link from 'next/link';

export function PlayerLink({
  id,
  name,
  className
}: {
  id?: string | null;
  name: string;
  className?: string;
}) {
  if (!id) {
    return <span className={className}>{name}</span>;
  }
  return (
    <Link href={`/players/${id}`} className={className ?? 'text-garnet-600 hover:text-garnet-500'}>
      {name}
    </Link>
  );
}
