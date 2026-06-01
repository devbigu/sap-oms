"use client";

import { useCartStore } from "@/Store/store";

type Props = {
  product: {
    id: string;
    name: string;
    price: number;
    packSize: number;  
    image?: string;
  };
};

export default function AddToCartButton({ product }: Props) {
  const addToCart = useCartStore((s) => s.addToCart);

  return (
    <button
      onClick={() => addToCart(product)}
      className="bg-yellow-400 border hover:bg-yellow-500 text-white px-4 py-2 rounded w-full"
    >
      Add to Cart
    </button>
  );
}
