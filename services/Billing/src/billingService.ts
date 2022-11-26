import { Bill, GuestBill, GuestOrders, ItemRegistration, Menu, PaidBill, PAYMENT_METHOD } from "./types/types";
import fetch from "node-fetch";
import { delay, getFibonacciSequence } from "./utils";

const MAX_RETRY_COUNT = 5;

export default class BillingService {
	deliveryIds: number[] = [];
	bills: Bill[] = [];
	guestOrders: GuestOrders[] = [];
	menu: Menu;
	billIdCounter = 1;
	retryCounter = MAX_RETRY_COUNT;
	fibonacciSeq = getFibonacciSequence(this.retryCounter);

	constructor() {
		( async () => {
			await this.getMenu();
		} )();
	}

	private async getMenu(): Promise<void> {
		// get menu from guest experience

		const path = `${process.env.API_GUEST_EXPERIENCE || "http://GuestExperience:8081"}/prices`;
		try {
			console.log("Cashier: Trying to get the menu from Manager.");

			const response = await fetch(path, { timeout: 5000 });
			this.menu = await response.json();

			console.log("Cashier: Got the menu from Manager.");
		} catch (e) {
			return await this.handleGetMenuErrors();
		}
	}

	private async handleGetMenuErrors() {
		if (this.retryCounter > 0) {
			console.log("Cashier: Couldn't get menu from Manager. I'll ask again in a few seconds.");

			const fibNum = this.fibonacciSeq[MAX_RETRY_COUNT - this.retryCounter];
			const retryIn = fibNum * 1000; // in ms
			await delay(retryIn);
		} else {
			console.log("Cashier: Seems like the manager is very busy. I'll wait a bit longer and ask again in a minute.");

			const retryIn = 60 * 1000; // in ms
			await delay(retryIn);
			this.retryCounter = MAX_RETRY_COUNT;
		}

		this.retryCounter--;
		return this.getMenu();
	}

	generateBill(guestDelivery: GuestOrders): GuestBill {
		// generate a bill from the unpaid items left for a certain customer

		const billIndex = this.bills.findIndex(bill => bill.guest === guestDelivery.guest);

		let newBill: Bill;

		if (billIndex >= 0) {
			const { bill, guest, orders } = this.bills[billIndex];
			const ordersCopy = orders.map(order => ( {
				order: order.order,
				food: [...order.food],
				drinks: [...order.drinks]
			} ));

			newBill = { bill, guest, orders: ordersCopy, totalSum: 0 };
		} else {
			newBill = { bill: this.billIdCounter, guest: guestDelivery.guest, orders: [], totalSum: 0 };

			this.billIdCounter++;
		}

		// add orders to the bill
		this.addFoodOrderToBill(guestDelivery, newBill);

		// calculate totalSum
		this.calculateTotalSum(newBill);

		if (billIndex >= 0) {
			this.bills.splice(billIndex, 1, newBill);
		} else {
			this.bills.push(newBill);
		}

		const { bill, orders, totalSum } = newBill;

		return {
			bill,
			orderedDrinks: orders.flatMap(order => order.drinks),
			orderedFood: orders.flatMap(order => order.food),
			totalSum: totalSum
		};
	}

	private addFoodOrderToBill(guestDelivery: GuestOrders, newBill: Bill) {
		guestDelivery.orders.forEach(order => {
			const existingOrder = newBill.orders?.find(billOrder => billOrder.order === order.order);

			if (existingOrder) {
				existingOrder.food = [...order.food];
				existingOrder.drinks = [...order.drinks];
			} else {
				newBill.orders.push({ order: order.order, food: [...order.food], drinks: [...order.drinks] });
			}
		});
	}

	private calculateTotalSum(newBill: Bill) {
		newBill.orders.forEach(order => {
			order.drinks.forEach(id => {
				const menuDrink = this.menu.drinks.find(drink => drink.id === id);

				newBill.totalSum += menuDrink.price;
			});

			order.food.forEach(id => {
				const menuFood = this.menu.food.find(food => food.id === id);

				newBill.totalSum += menuFood.price;
			});
		});
	}

	getPaymentOption(amount: number): PAYMENT_METHOD[] {
		// return the available payment options depending on the price

		const paymentMethods = [PAYMENT_METHOD.Cash];

		if (amount < 20) return paymentMethods;

		return [...paymentMethods, PAYMENT_METHOD.DebitCard, PAYMENT_METHOD.CreditCard];
	}

	registerPayment(billId: number) {
		// register a new payment and mark items as paid

		console.log("Cashier: I received a payment");

		const billIndex = this.bills.findIndex(bill => bill.bill === billId);
		const bill = this.bills[billIndex];
		const paidOrders = bill.orders.flatMap(order => ( { order: order.order, paidDrinks: [...order.drinks], paidFood: [...order.food] } ));

		const paidBill: PaidBill = {
			bill: billId,
			paidOrders,
			totalSum: bill.totalSum
		};

		// remove items from delivered items
		const { deliveredItemsIndex, deliveredOrders } = this.removeBillItemsFromDeliveredItems(bill);

		// remove empty orders
		this.guestOrders[deliveredItemsIndex].orders = deliveredOrders.filter(order => order.food.length > 0 || order.drinks.length > 0);

		// remove bill
		this.bills.splice(billIndex, 1);

		return paidBill;
	}

	private removeBillItemsFromDeliveredItems(bill: Bill) {
		const deliveredItemsIndex = this.guestOrders.findIndex(items => +items.guest === +bill.guest);
		const deliveredOrders = this.guestOrders[deliveredItemsIndex].orders;

		deliveredOrders.forEach(order => {
			const billOrder = bill.orders.find(orderObj => +orderObj.order === +order.order);

			if (billOrder) {
				billOrder.drinks.forEach(drinkId => {
					if (order.drinks.includes(drinkId)) {
						const index = order.drinks.findIndex(drink => drinkId === drink);
						order.drinks.splice(index, 1);
					}
				});

				billOrder.food.forEach(foodId => {
					if (order.food.includes(foodId)) {
						const index = order.food.findIndex(food => foodId === food);
						order.food.splice(index, 1);
					}
				});

			}
		});
		return { deliveredItemsIndex, deliveredOrders };
	}

	registerDeliveredItems(itemRegistration: ItemRegistration) {
		// register items which are delivered to a guest

		const { guest, order, food, drinks } = itemRegistration;

		const guestDelivery = this.guestOrders.find(items => +items.guest === +guest);

		if (guestDelivery) {
			const guestOrder = guestDelivery.orders.find(deliveryOrder => +deliveryOrder.order === +order);
			if (guestOrder) {
				console.log("Cashier: I'm adding items to an existing order");
				guestOrder.food = guestOrder.food.concat(food);
				guestOrder.drinks = guestOrder.drinks.concat(drinks);
			} else {
				console.log("Cashier: I'm adding a new order to an existing Guest with id " + guest);
				guestDelivery.orders.push({ food, drinks, order });
			}
		} else {
			console.log("Cashier: I'm adding a new guest with his first order");
			this.guestOrders.push({ guest, orders: [{ food, drinks, order }] });
		}

	}
}

