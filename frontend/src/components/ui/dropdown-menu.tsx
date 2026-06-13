import { Check } from 'lucide-react';
import { DropdownMenu as Primitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function DropdownMenu(props: React.ComponentProps<typeof Primitive.Root>) {
	return <Primitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(
	props: React.ComponentProps<typeof Primitive.Trigger>,
) {
	return <Primitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	className,
	sideOffset = 6,
	align = 'end',
	...props
}: React.ComponentProps<typeof Primitive.Content>) {
	return (
		<Primitive.Portal>
			<Primitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				align={align}
				className={cn(
					'z-50 min-w-[10rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md',
					'data-[state=open]:animate-in data-[state=closed]:animate-out',
					'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
					'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
					'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
					className,
				)}
				{...props}
			/>
		</Primitive.Portal>
	);
}

function DropdownMenuLabel({
	className,
	...props
}: React.ComponentProps<typeof Primitive.Label>) {
	return (
		<Primitive.Label
			data-slot="dropdown-menu-label"
			className={cn(
				'px-2 py-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase',
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuItem({
	className,
	...props
}: React.ComponentProps<typeof Primitive.Item>) {
	return (
		<Primitive.Item
			data-slot="dropdown-menu-item"
			className={cn(
				"relative flex w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
				'focus:bg-accent focus:text-accent-foreground',
				'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof Primitive.CheckboxItem>) {
	return (
		<Primitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			checked={checked}
			className={cn(
				'relative flex w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-none transition-colors',
				'focus:bg-accent focus:text-accent-foreground',
				'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<Primitive.ItemIndicator>
					<Check className="h-3.5 w-3.5" />
				</Primitive.ItemIndicator>
			</span>
			{children}
		</Primitive.CheckboxItem>
	);
}

function DropdownMenuRadioGroup(
	props: React.ComponentProps<typeof Primitive.RadioGroup>,
) {
	return (
		<Primitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
	);
}

function DropdownMenuRadioItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof Primitive.RadioItem>) {
	return (
		<Primitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			className={cn(
				'relative flex w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm outline-none transition-colors',
				'focus:bg-accent focus:text-accent-foreground',
				'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<Primitive.ItemIndicator>
					<Check className="h-3.5 w-3.5" />
				</Primitive.ItemIndicator>
			</span>
			{children}
		</Primitive.RadioItem>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof Primitive.Separator>) {
	return (
		<Primitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn('-mx-1 my-1 h-px bg-border', className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
};
