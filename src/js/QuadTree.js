export class QuadTree {
    constructor(bounds, pointQuad, maxDepth, maxChildren) {
        this.root = pointQuad ? new Node(bounds, 0, maxDepth, maxChildren)
            : new BoundsNode(bounds, 0, maxDepth, maxChildren);
    }
    /**
     * Inserts an item into the QuadTree.
     * @method insert
     * @param {Object|Array} items The item or Array of items to be inserted into the QuadTree. The item should expose x, y
     * properties that represents its position in 2D space.
     **/
    insert(items) {
        [].concat(items).forEach(item=> {
            this.root.insert(item);
        })
    }
    clear() {
        this.root.clear();
    }
    /**
     * Retrieves all items / points in the same node as the specified item / point. If the specified item
     * overlaps the bounds of a node, then all children in both nodes will be returned.
     * @method retrieve
     * @param {Object} item An object representing a 2D coordinate point (with x, y properties), or a shape
     * with dimensions (x, y, width, height) properties.
     **/
    retrieve(item) {
        //get a copy of the array of items
        return this.root.retrieve(item).slice(0);
    }
}

class Node {
    static TOP_LEFT = 0;
    static TOP_RIGHT = 1;
    static BOTTOM_LEFT = 2;
    static BOTTOM_RIGHT = 3;
    constructor(bounds, depth = 0, maxDepth = 4, maxChildren = 4) {
        this._bounds = bounds;
        this.children = [];
        this.nodes = [];
        this._maxChildren = maxChildren;
        this._maxDepth = maxDepth;
        this._depth = depth;
    }
    clear(){
        this.children.length = 0;
        const len = this.nodes.length;
        for (let i = 0; i < len; i++) this.nodes[i].clear();
        this.nodes.length = 0;
    }
    subdivide() {
        const depth = this._depth + 1;
        const bx = this._bounds.x;
        const by = this._bounds.y;

        //floor the values
        const b_w_h = (this._bounds.width / 2); //todo: Math.floor?
        const b_h_h = (this._bounds.height / 2);
        const bx_b_w_h = bx + b_w_h;
        const by_b_h_h = by + b_h_h;

        const cons = Object.getPrototypeOf(this).constructor;
        //top left
        this.nodes[Node.TOP_LEFT] = new cons(
            {
                x: bx,
                y: by,
                width: b_w_h,
                height: b_h_h
            },
            depth, this._maxDepth, this._maxChildren
        );

        //top right
        this.nodes[Node.TOP_RIGHT] = new cons(
            {
                x: bx_b_w_h,
                y: by,
                width: b_w_h,
                height: b_h_h
            },
            depth, this._maxDepth, this._maxChildren
        );

        //bottom left
        this.nodes[Node.BOTTOM_LEFT] = new cons(
            {
                x: bx,
                y: by_b_h_h,
                width: b_w_h,
                height: b_h_h
            },
            depth, this._maxDepth, this._maxChildren
        );


        //bottom right
        this.nodes[Node.BOTTOM_RIGHT] = new cons(
            {
                x: bx_b_w_h,
                y: by_b_h_h,
                width: b_w_h,
                height: b_h_h
            },
            depth, this._maxDepth, this._maxChildren
        );
    };
    _findIndex(item) {
        const b = this._bounds;
        const left = (item.x <= b.x + b.width / 2);
        const top = (item.y <= b.y + b.height / 2);
        let index = Node.TOP_LEFT;
        if (left) {
            if (!top) {
                index = Node.BOTTOM_LEFT;
            }
        } else {
            if (top) {
                index = Node.TOP_RIGHT;
            } else {
                index = Node.BOTTOM_RIGHT;
            }
        }
        return index;
    }
    insert(item) {
        if (this.nodes.length) {
            const index = this._findIndex(item);
            this.nodes[index].insert(item);
            return;
        }
        this.children.push(item);
        const len = this.children.length;
        if (!(this._depth >= this._maxDepth) && len > this._maxChildren) {
            this.subdivide();
            for (let i = 0; i < len; i++) {
                this.insert(this.children[i]);
            }
            this.children.length = 0;
        }
    }
    retrieve(item) {
        if (this.nodes.length) {
            return this.nodes[this._findIndex(item)].retrieve(item);
        }
        return this.children;
    };
}

class BoundsNode extends Node{
    constructor(bounds, depth, maxChildren, maxDepth) {
        super(bounds, depth, maxChildren, maxDepth);
        this._stuckChildren = [];
        this._out = [];
    }
    insert(item){
        if (this.nodes.length) {
            const index = this._findIndex(item);
            const node = this.nodes[index];

            //todo: make _bounds bounds
            if (item.x >= node._bounds.x &&
                item.x + item.width <= node._bounds.x + node._bounds.width &&
                item.y >= node._bounds.y &&
                item.y + item.height <= node._bounds.y + node._bounds.height) {
                this.nodes[index].insert(item);
            } else {
                this._stuckChildren.push(item);
            }

            return;
        }

        this.children.push(item);

        const len = this.children.length;

        if (!(this._depth >= this._maxDepth) && len > this._maxChildren) {
            this.subdivide();
            for (let i = 0; i < len; i++) this.insert(this.children[i]);
            this.children.length = 0;
        }
    }
    getChildren(){
        return this.children.concat(this._stuckChildren);
    }
    retrieve(item) {
        const out = this._out;
        out.length = 0;
        if (this.nodes.length) {
            const index = this._findIndex(item);
            const node = this.nodes[index];

            if (item.x >= node._bounds.x &&
                item.x + item.width <= node._bounds.x + node._bounds.width &&
                item.y >= node._bounds.y &&
                item.y + item.height <= node._bounds.y + node._bounds.height) {

                out.push(this.nodes[index].retrieve(item));
            } else {
                //Part of the item are overlapping multiple child nodes. For each of the overlapping nodes, return all containing objects.
                if (item.x <= this.nodes[Node.TOP_RIGHT]._bounds.x) {
                    if (item.y <= this.nodes[Node.BOTTOM_LEFT]._bounds.y) {
                        out.push(this.nodes[Node.TOP_LEFT].getAllContent());
                    }

                    if (item.y + item.height > this.nodes[Node.BOTTOM_LEFT]._bounds.y) {
                        out.push(this.nodes[Node.BOTTOM_LEFT].getAllContent());
                    }
                }

                if (item.x + item.width > this.nodes[Node.TOP_RIGHT]._bounds.x) {//position+width bigger than middle x
                    if (item.y <= this.nodes[Node.BOTTOM_RIGHT]._bounds.y) {
                        out.push(this.nodes[Node.TOP_RIGHT].getAllContent());
                    }

                    if (item.y + item.height > this.nodes[Node.BOTTOM_RIGHT]._bounds.y) {
                        out.push(this.nodes[Node.BOTTOM_RIGHT].getAllContent());
                    }
                }
            }
        }

        out.push(this._stuckChildren);
        out.push(this.children);

        return out.flat();
    }
    getAllContent() {
        const out = this._out;
        if (this.nodes.length) {
            for (let i = 0; i < this.nodes.length; i++) this.nodes[i].getAllContent();
        }
        out.push(this._stuckChildren);
        out.push(this.children);
        return out.flat();
    }
    clear() {
        this._stuckChildren.length = 0;
        this.children.length = 0;
        const len = this.nodes.length;
        if (!len) return;
        for (let i = 0; i < len; i++) this.nodes[i].clear();
        this.nodes.length = 0;
    }
}
